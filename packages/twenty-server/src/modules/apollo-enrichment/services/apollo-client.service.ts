import { Injectable } from '@nestjs/common';

import { type AxiosInstance, isAxiosError } from 'axios';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  type ApolloOrganizationEnrichResponse,
  type ApolloOrganizationMatchInput,
  type ApolloPersonEnrichmentOptions,
  type ApolloPersonMatchInput,
  type ApolloPersonMatchResponse,
  type ApolloPhoneEnrichmentWebhookPayload,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';

type ApolloPeopleMatchParams = {
  email?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  organization_name?: string;
  reveal_personal_emails: boolean;
  reveal_phone_number: boolean;
  webhook_url?: string;
};

type ApolloOrganizationEnrichRequest = {
  domain?: string;
  linkedin_url?: string;
  name?: string;
  website?: string;
};

type ApolloPhoneEnrichmentPollApiResponse =
  ApolloPhoneEnrichmentWebhookPayload & {
    error_code?: string | null;
    retry_after_seconds?: number | null;
  };

export type ApolloPhoneEnrichmentPollResult =
  | {
      status: 'pending';
    }
  | {
      payload: ApolloPhoneEnrichmentWebhookPayload;
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
    },
    onProviderStart?: () => Promise<void>,
  ): Promise<ApolloPersonMatchResponse> {
    if (options.revealPhoneNumber && !options.webhookUrl) {
      throw new ApolloEnrichmentError(
        'Apollo phone enrichment requires a webhook URL',
        false,
      );
    }

    const params: ApolloPeopleMatchParams = {
      ...(input.email ? { email: input.email } : {}),
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : {}),
      ...(input.organizationName
        ? { organization_name: input.organizationName }
        : {}),
      reveal_personal_emails: options.revealPersonalEmails,
      reveal_phone_number: options.revealPhoneNumber,
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

    // Apollo returns demographic data synchronously and sends revealed phone
    // numbers to webhook_url later. The request must not stay open while that
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

  async pollPhoneEnrichment(
    requestId: string,
  ): Promise<ApolloPhoneEnrichmentPollResult> {
    const response =
      await this.getHttpClient().get<ApolloPhoneEnrichmentPollApiResponse>(
        `/webhook_result/${encodeURIComponent(requestId)}`,
        {
          validateStatus: (statusCode) =>
            statusCode === 200 ||
            statusCode === 400 ||
            statusCode === 404 ||
            statusCode === 410,
        },
      );

    if (response.status === 200) {
      return {
        payload: response.data,
        status: 'ready',
      };
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
