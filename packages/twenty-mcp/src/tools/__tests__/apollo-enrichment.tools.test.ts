import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../server.js';
import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { apolloEnrichmentToolsTesting } from '../apollo-enrichment.tools.js';

const PERSON_ID = '1c4e0f78-4a92-48d8-8bb2-5d4af4df3844';
const COMPANY_ID = 'cd91ce89-09ea-4e4f-bc97-c38b73ea0993';

const enrichmentResult = {
  requestedCount: 1,
  updatedCount: 1,
  skippedCount: 0,
  notMatchedCount: 0,
  notFoundCount: 0,
  failedCount: 0,
  disabled: false,
};

const callApolloTool = async ({
  arguments: toolArguments,
  graphqlResult,
  hasUserToken = true,
  name,
}: {
  arguments: Record<string, unknown>;
  graphqlResult: Record<string, unknown>;
  hasUserToken?: boolean;
  name: string;
}) => {
  const graphql = jest.fn().mockResolvedValue(graphqlResult);
  const server = createMcpServer({
    client: {
      graphql,
      hasUserToken: () => hasUserToken,
    } as unknown as TwentyClient,
    metadata: {} as MetadataService,
    enableAdvanced: false,
  });
  const client = new Client({
    name: 'twenty-apollo-enrichment-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    return {
      graphql,
      result: await client.callTool({
        name,
        arguments: toolArguments,
      }),
    };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe('Apollo enrichment MCP tools', () => {
  it.each([
    {
      name: 'twenty_enrich_people_with_apollo',
      operationName: 'TwentyMcpEnrichPeopleWithApollo',
      recordId: PERSON_ID,
      responseField: 'enrichPeopleWithApollo',
    },
    {
      name: 'twenty_enrich_people_phones_with_apollo',
      operationName: 'TwentyMcpEnrichPeoplePhonesWithApollo',
      recordId: PERSON_ID,
      responseField: 'enrichPeoplePhonesWithApollo',
    },
    {
      name: 'twenty_enrich_companies_with_apollo',
      operationName: 'TwentyMcpEnrichCompaniesWithApollo',
      recordId: COMPANY_ID,
      responseField: 'enrichCompaniesWithApollo',
    },
  ])(
    'calls the user-scoped $operationName mutation for $name',
    async ({ name, operationName, recordId, responseField }) => {
      const { graphql, result } = await callApolloTool({
        name,
        arguments: {
          record_ids: [recordId],
          confirm: true,
          response_format: 'json',
        },
        graphqlResult: { [responseField]: enrichmentResult },
      });

      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining(`mutation ${operationName}`),
        { input: { recordIds: [recordId] } },
        { endpoint: 'metadata', token: 'user' },
      );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        result: enrichmentResult,
      });
    },
  );

  it('does not call Apollo enrichment before explicit confirmation', async () => {
    const { graphql, result } = await callApolloTool({
      name: 'twenty_enrich_people_with_apollo',
      arguments: {
        record_ids: [PERSON_ID],
        confirm: false,
      },
      graphqlResult: { enrichPeopleWithApollo: enrichmentResult },
    });

    expect(graphql).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining(
            'confirm the exact record IDs and Apollo credit usage',
          ),
        }),
      ]),
    );
  });

  it('requires a user token for the user-authenticated resolver', async () => {
    const { graphql, result } = await callApolloTool({
      name: 'twenty_enrich_companies_with_apollo',
      arguments: {
        record_ids: [COMPANY_ID],
        confirm: true,
      },
      graphqlResult: { enrichCompaniesWithApollo: enrichmentResult },
      hasUserToken: false,
    });

    expect(graphql).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('TWENTY_USER_TOKEN'),
        }),
      ]),
    );
  });

  it('rejects duplicate targets before invoking a tool', () => {
    expect(
      apolloEnrichmentToolsTesting.apolloEnrichmentInputSchema.safeParse({
        record_ids: [PERSON_ID, PERSON_ID],
        confirm: true,
      }).success,
    ).toBe(false);
  });
});
