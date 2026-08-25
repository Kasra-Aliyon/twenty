import { Injectable } from '@nestjs/common';

import { type AxiosInstance, isAxiosError } from 'axios';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  type ApolloEnrichmentWebhookPayload,
  type ApolloOrganizationEnrichResponse,
  type ApolloOrganizationMatchInput,
  type ApolloPersonEnrichmentOptions,
  type ApolloPersonMatchInput,
  type ApolloPersonMatchResponse,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';

type ApolloPeopleMatchParams = {
  domain?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  organization_name?: string;
  reveal_personal_emails: boolean;
  reveal_phone_number: boolean;
  run_waterfall_email: boolean;
  run_waterfall_phone: boolean;
  webhook_url?: string;
};

type ApolloOrganizationEnrichRequest = {
  domain?: string;
  linkedin_url?: string;
  name?: string;
  website?: string;
};

type ApolloEnrichmentPollApiResponse = {
  error_code?: string | null;
  retry_after_seconds?: number | null;
  webhook_result?: ApolloEnrichmentWebhookPayload | null;
  webhook_status?: 'failed' | 'in_progress' | 'success' | string | null;
};

export type ApolloEnrichmentPollResult =
  | {
      status: 'pending';
    }
  | {
      payload: ApolloEnrichmentWebhookPayload;
      status: 'ready';
    }
  | {
      status: 'terminal';
    };

@Injectable()
export class ApolloClientService {
  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async enrichPerson(
    input: ApolloPersonMatchInput,
    options: ApolloPersonEnrichmentOptions = {
      revealPersonalEmails: false,
      revealPhoneNumber: false,
      runWaterfallEmail: false,
      runWaterfallPhone: false,
    },
    onProviderStart?: () => Promise<void>,
  ): Promise<ApolloPersonMatchResponse> {
    if (
      (options.revealPhoneNumber ||
        options.runWaterfallEmail ||
        options.runWaterfallPhone) &&
      !options.webhookUrl
    ) {
      throw new ApolloEnrichmentError(
        'Apollo asynchronous enrichment requires a webhook URL',
        false,
      );
    }

    const params: ApolloPeopleMatchParams = {
      ...(input.email ? { email: input.email } : {}),
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : {}),
      ...(input.organizationDomain ? { domain: input.organizationDomain } : {}),
      ...(input.organizationName
        ? { organization_name: input.organizationName }
        : {}),
      reveal_personal_emails: options.revealPersonalEmails,
      reveal_phone_number: options.revealPhoneNumber,
      run_waterfall_email: options.runWaterfallEmail,
      run_waterfall_phone: options.runWaterfallPhone,
      ...(options.webhookUrl ? { webhook_url: options.webhookUrl } : {}),
    };

    const httpClient = this.getHttpClient();

    await onProviderStart?.();

    const response = await httpClient.post<ApolloPersonMatchResponse>(
      '/people/match',
      undefined,
      {
        params,
      },
    );

    // Apollo returns demographic data synchronously and sends waterfall or
    // revealed fields to webhook_url later. Do not hold the request open while
    // asynchronous delivery is pending.
    return response.data;
  }

  async enrichOrganization(
    input: ApolloOrganizationMatchInput,
  ): Promise<ApolloOrganizationEnrichResponse> {
    const params: ApolloOrganizationEnrichRequest = {
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.website ? { website: input.website } : {}),
    };

    const response =
      await this.getHttpClient().get<ApolloOrganizationEnrichResponse>(
        '/organizations/enrich',
        { params },
      );

    return response.data;
  }

  async pollEnrichment(requestId: string): Promise<ApolloEnrichmentPollResult> {
    const response =
      await this.getHttpClient().get<ApolloEnrichmentPollApiResponse>(
        `/webhook_result/${encodeURIComponent(requestId)}`,
        {
          validateStatus: (statusCode) =>
            statusCode === 200 ||
            statusCode === 400 ||
            statusCode === 404 ||
            statusCode === 410,
        },
      );

    if (
      response.status === 200 &&
      response.data.webhook_status === 'success' &&
      response.data.webhook_result
    ) {
      return {
        payload: response.data.webhook_result,
        status: 'ready',
      };
    }

    if (
      response.status === 200 &&
      response.data.webhook_status === 'in_progress'
    ) {
      return { status: 'pending' };
    }

    if (
      response.status === 404 &&
      response.data.error_code === 'result_pending'
    ) {
      return { status: 'pending' };
    }

    return { status: 'terminal' };
  }

  private getHttpClient(): AxiosInstance {
    const apiKey = this.twentyConfigService.get('APOLLO_API_KEY');

    if (!apiKey) {
      throw new ApolloEnrichmentError(
        'Apollo API key is not configured',
        false,
      );
    }

    const client = this.secureHttpClientService.getHttpClient({
      baseURL: this.twentyConfigService.get('APOLLO_API_BASE_URL'),
      timeout: 30_000,
      transformResponse: [(data: unknown) => this.parseApolloApiResponse(data)],
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    client.interceptors.response.use(
      (response) => response,
      (error: unknown) => {
        if (!isAxiosError(error)) {
          throw error;
        }

        const statusCode = error.response?.status;
        const retryable =
          statusCode === 429 ||
          statusCode === undefined ||
          (statusCode >= 500 && statusCode <= 599);
        const message = `Apollo API request failed${
          statusCode ? ` with status ${statusCode}` : ''
        }`;

        throw new ApolloEnrichmentError(message, retryable, statusCode);
      },
    );

    return client;
  }

  private parseApolloApiResponse(data: unknown): unknown {
    if (typeof data !== 'string') {
      return data;
    }

    try {
      const dataWithStringRequestIds = data.replace(
        /("request_id"\s*:\s*)(-?\d+)(?=\s*[,}])/g,
        '$1"$2"',
      );

      return JSON.parse(dataWithStringRequestIds) as unknown;
    } catch {
      return data;
    }
  }
}
