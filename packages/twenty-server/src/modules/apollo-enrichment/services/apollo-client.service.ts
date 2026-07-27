import { Injectable } from '@nestjs/common';

import { type AxiosInstance, isAxiosError } from 'axios';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  type ApolloOrganizationEnrichResponse,
  type ApolloOrganizationMatchInput,
  type ApolloPerson,
  type ApolloPersonEnrichmentOptions,
  type ApolloPersonMatchInput,
  type ApolloPersonMatchResponse,
  type ApolloWebhookResultResponse,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';

type ApolloPeopleMatchRequest = {
  email?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  organization_name?: string;
};

type ApolloOrganizationEnrichRequest = {
  domain?: string;
  linkedin_url?: string;
  name?: string;
  website?: string;
};

const APOLLO_PHONE_POLL_ATTEMPTS = 30;
const APOLLO_PHONE_POLL_INTERVAL_MS = 10_000;

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
  ): Promise<ApolloPersonMatchResponse> {
    const request: ApolloPeopleMatchRequest = {
      ...(input.email ? { email: input.email } : {}),
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : {}),
      ...(input.organizationName
        ? { organization_name: input.organizationName }
        : {}),
    };

    const response = await this.getHttpClient().post<ApolloPersonMatchResponse>(
      '/people/match',
      request,
      {
        params: {
          reveal_personal_emails: options.revealPersonalEmails,
          reveal_phone_number: options.revealPhoneNumber,
          ...(options.revealPhoneNumber
            ? { webhook_url: this.buildPhoneEnrichmentWebhookUrl() }
            : {}),
        },
      },
    );

    if (
      !options.revealPhoneNumber ||
      this.hasPhoneNumber(response.data.person) ||
      !response.data.request_id
    ) {
      return response.data;
    }

    const phonePerson = await this.pollPhoneEnrichment(
      String(response.data.request_id),
    );

    if (!phonePerson) {
      return response.data;
    }

    return {
      ...response.data,
      person: {
        ...response.data.person,
        ...phonePerson,
      },
    };
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

  private async pollPhoneEnrichment(
    requestId: string,
  ): Promise<ApolloPerson | undefined> {
    for (let attempt = 0; attempt < APOLLO_PHONE_POLL_ATTEMPTS; attempt++) {
      await this.wait(APOLLO_PHONE_POLL_INTERVAL_MS);

      const result = await this.getWebhookResult(requestId);

      if (!result || result.webhook_status === 'in_progress') {
        continue;
      }

      if (result.webhook_status === 'failed') {
        throw new ApolloEnrichmentError(
          result.failure_reason ?? 'Apollo phone enrichment failed',
          false,
        );
      }

      return result.webhook_result?.people?.[0] ?? undefined;
    }

    throw new ApolloEnrichmentError('Apollo phone enrichment timed out', true);
  }

  private async getWebhookResult(
    requestId: string,
  ): Promise<ApolloWebhookResultResponse | undefined> {
    try {
      const response =
        await this.getHttpClient().get<ApolloWebhookResultResponse>(
          `/webhook_result/${encodeURIComponent(requestId)}`,
        );

      return response.data;
    } catch (error) {
      if (error instanceof ApolloEnrichmentError && error.statusCode === 404) {
        return undefined;
      }

      throw error;
    }
  }

  private buildPhoneEnrichmentWebhookUrl(): string {
    return new URL(
      '/webhooks/apollo/enrichment',
      this.twentyConfigService.get('SERVER_URL'),
    ).toString();
  }

  private hasPhoneNumber(person: ApolloPerson | null | undefined): boolean {
    return Boolean(
      person?.sanitized_phone ||
      person?.phone ||
      person?.phone_numbers?.some(
        (phoneNumber) => phoneNumber.sanitized_number || phoneNumber.raw_number,
      ),
    );
  }

  private async wait(durationMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
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
