import { Injectable } from '@nestjs/common';

import { type AxiosInstance, isAxiosError } from 'axios';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  type ApolloOrganizationEnrichResponse,
  type ApolloOrganizationMatchInput,
  type ApolloPersonMatchInput,
  type ApolloPersonMatchResponse,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';

type ApolloPeopleMatchRequest = {
  email?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  organization_name?: string;
  reveal_personal_emails: boolean;
  reveal_phone_number: boolean;
};

type ApolloOrganizationEnrichRequest = {
  domain?: string;
  linkedin_url?: string;
  name?: string;
  website?: string;
};

@Injectable()
export class ApolloClientService {
  constructor(
    private readonly secureHttpClientService: SecureHttpClientService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async enrichPerson(
    input: ApolloPersonMatchInput,
  ): Promise<ApolloPersonMatchResponse> {
    const request: ApolloPeopleMatchRequest = {
      ...(input.email ? { email: input.email } : {}),
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : {}),
      ...(input.organizationName
        ? { organization_name: input.organizationName }
        : {}),
      reveal_personal_emails: this.twentyConfigService.get(
        'APOLLO_REVEAL_PERSONAL_EMAILS',
      ),
      reveal_phone_number: this.twentyConfigService.get(
        'APOLLO_REVEAL_PHONE_NUMBER',
      ),
    };

    const response = await this.getHttpClient().post<ApolloPersonMatchResponse>(
      '/people/match',
      request,
    );

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
}
