import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';

const APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST = 100;

const APOLLO_ENRICHMENT_RESULT_FIELDS = `
  requestedCount
  updatedCount
  skippedCount
  notMatchedCount
  notFoundCount
  failedCount
  disabled
`;

const ENRICH_PEOPLE_WITH_APOLLO_MUTATION = `
  mutation TwentyMcpEnrichPeopleWithApollo(
    $input: ApolloEnrichRecordsInput!
  ) {
    enrichPeopleWithApollo(input: $input) {
      ${APOLLO_ENRICHMENT_RESULT_FIELDS}
    }
  }
`;

const ENRICH_PEOPLE_PHONES_WITH_APOLLO_MUTATION = `
  mutation TwentyMcpEnrichPeoplePhonesWithApollo(
    $input: ApolloEnrichRecordsInput!
  ) {
    enrichPeoplePhonesWithApollo(input: $input) {
      ${APOLLO_ENRICHMENT_RESULT_FIELDS}
    }
  }
`;

const ENRICH_COMPANIES_WITH_APOLLO_MUTATION = `
  mutation TwentyMcpEnrichCompaniesWithApollo(
    $input: ApolloEnrichRecordsInput!
  ) {
    enrichCompaniesWithApollo(input: $input) {
      ${APOLLO_ENRICHMENT_RESULT_FIELDS}
    }
  }
`;

type ApolloEnrichmentBatchResult = {
  requestedCount: number;
  updatedCount: number;
  skippedCount: number;
  notMatchedCount: number;
  notFoundCount: number;
  failedCount: number;
  disabled: boolean;
};

const apolloEnrichmentInputSchema = z.object({
  record_ids: z
    .array(recordIdSchema)
    .min(1)
    .max(APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST)
    .refine((recordIds) => new Set(recordIds).size === recordIds.length, {
      message: 'record_ids must not contain duplicates.',
    })
    .describe('Exact Twenty person or company UUIDs to enrich.'),
  confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
  response_format: responseFormatSchema,
});

const assertApolloEnrichmentConfirmed = (
  confirm: boolean,
  enrichmentLabel: string,
): void => {
  if (!confirm) {
    throw new Error(
      `${enrichmentLabel} not requested: confirm the exact record IDs and Apollo credit usage first.`,
    );
  }
};

export const registerApolloEnrichmentTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  server.registerTool(
    'twenty_enrich_people_with_apollo',
    {
      title: 'Enrich people with Apollo',
      description:
        'Enriches empty person data and email fields for up to 100 people. Phone numbers are excluded. Can consume up to one Apollo credit per matched person. Requires TWENTY_USER_TOKEN and explicit confirmation of all record IDs.',
      inputSchema: apolloEnrichmentInputSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ record_ids, confirm, response_format }) =>
      runTool(async () => {
        assertApolloEnrichmentConfirmed(confirm, 'Apollo person enrichment');

        const result = await dependencies.client.graphql<{
          enrichPeopleWithApollo: ApolloEnrichmentBatchResult;
        }>(
          ENRICH_PEOPLE_WITH_APOLLO_MUTATION,
          { input: { recordIds: record_ids } },
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.enrichPeopleWithApollo;
      }, response_format),
  );

  server.registerTool(
    'twenty_enrich_people_phones_with_apollo',
    {
      title: 'Enrich people phone numbers with Apollo',
      description:
        'Requests phone enrichment for up to 100 people. Apollo may deliver phone results asynchronously over several minutes and can consume up to nine credits per matched person. Requires TWENTY_USER_TOKEN and explicit confirmation of all record IDs.',
      inputSchema: apolloEnrichmentInputSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ record_ids, confirm, response_format }) =>
      runTool(async () => {
        assertApolloEnrichmentConfirmed(
          confirm,
          'Apollo person phone enrichment',
        );

        const result = await dependencies.client.graphql<{
          enrichPeoplePhonesWithApollo: ApolloEnrichmentBatchResult;
        }>(
          ENRICH_PEOPLE_PHONES_WITH_APOLLO_MUTATION,
          { input: { recordIds: record_ids } },
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.enrichPeoplePhonesWithApollo;
      }, response_format),
  );

  server.registerTool(
    'twenty_enrich_companies_with_apollo',
    {
      title: 'Enrich companies with Apollo',
      description:
        'Enriches empty company fields for up to 100 companies. Can consume up to one Apollo credit per matched company. Requires TWENTY_USER_TOKEN and explicit confirmation of all record IDs.',
      inputSchema: apolloEnrichmentInputSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ record_ids, confirm, response_format }) =>
      runTool(async () => {
        assertApolloEnrichmentConfirmed(confirm, 'Apollo company enrichment');

        const result = await dependencies.client.graphql<{
          enrichCompaniesWithApollo: ApolloEnrichmentBatchResult;
        }>(
          ENRICH_COMPANIES_WITH_APOLLO_MUTATION,
          { input: { recordIds: record_ids } },
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.enrichCompaniesWithApollo;
      }, response_format),
  );
};

export const apolloEnrichmentToolsTesting = {
  apolloEnrichmentInputSchema,
};
