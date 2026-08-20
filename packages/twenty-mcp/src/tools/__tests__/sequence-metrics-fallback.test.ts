import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TwentyApiError } from '../../services/errors.js';
import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { registerSequenceTools } from '../sequences.tools.js';

const missingSequenceAnalyticsError = new TwentyApiError({
  message: 'Cannot query field "sequenceAnalytics" on type "Query".',
  code: 'GRAPHQL_ERROR',
});

const callSequenceMetricsTool = async ({
  graphql,
  rest,
}: {
  graphql: jest.Mock;
  rest: jest.Mock;
}) => {
  const getObject = jest.fn().mockImplementation(async (object: string) => ({
    namePlural: object,
  }));
  const server = new McpServer({
    name: 'twenty-sequence-metrics-fallback-test-server',
    version: '1.0.0',
  });

  registerSequenceTools(server, {
    client: {
      graphql,
      hasUserToken: () => false,
      rest,
    } as unknown as TwentyClient,
    metadata: { getObject } as unknown as MetadataService,
    enableAdvanced: false,
  });

  const client = new Client({
    name: 'twenty-sequence-metrics-fallback-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    return await client.callTool({
      name: 'twenty_get_sequence_metrics',
      arguments: {
        sequence_id: 'sequence-id',
        response_format: 'json',
      },
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

const createFallbackRestMock = () =>
  jest
    .fn()
    .mockImplementation(
      async (
        _method: string,
        path: string,
        options?: { query?: Record<string, unknown> },
      ) => {
        if (path === '/rest/sequences/sequence-id') {
          return {
            data: {
              sequence: {
                id: 'sequence-id',
                name: 'Sequence',
                enrolledCount: 2,
                completedCount: 1,
                repliedCount: 1,
                failedCount: 0,
              },
            },
          };
        }

        if (path === '/rest/sequenceEnrollments/groupBy') {
          return { data: { REPLIED: 1, COMPLETED: 1 } };
        }

        if (path === '/rest/sequenceSteps') {
          return {
            data: {
              sequenceSteps: [
                {
                  id: 'email-step-id',
                  name: 'Introduction',
                  position: 0,
                  settings: {
                    type: 'SEND_EMAIL',
                    variants: [
                      { id: 'variant-a', name: 'A' },
                      { id: 'variant-b', name: 'B' },
                    ],
                  },
                },
              ],
            },
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              endCursor: 'step-cursor',
            },
          };
        }

        if (
          path === '/rest/sequenceEnrollments' &&
          options?.query?.starting_after === undefined
        ) {
          return {
            data: {
              sequenceEnrollments: [
                {
                  id: 'enrollment-a',
                  status: 'REPLIED',
                  sentEmailsByStepId: {
                    'email-step-id': {
                      variantId: 'variant-a',
                      variantName: 'A',
                      repliedAt: '2026-08-20T10:00:00.000Z',
                    },
                  },
                },
              ],
            },
            pageInfo: {
              hasNextPage: true,
              hasPreviousPage: false,
              endCursor: 'enrollment-cursor',
            },
          };
        }

        if (
          path === '/rest/sequenceEnrollments' &&
          options?.query?.starting_after === 'enrollment-cursor'
        ) {
          return {
            data: {
              sequenceEnrollments: [
                {
                  id: 'enrollment-b',
                  status: 'COMPLETED',
                  sentEmailsByStepId: {
                    'email-step-id': {
                      variantId: 'variant-b',
                      variantName: 'B',
                    },
                  },
                },
              ],
            },
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              endCursor: 'enrollment-end-cursor',
            },
          };
        }

        throw new Error(`Unexpected REST request: ${path}`);
      },
    );

describe('sequence metrics GraphQL compatibility fallback', () => {
  it('rebuilds full analytics from paginated REST records when the resolver is absent', async () => {
    const graphql = jest.fn().mockRejectedValue(missingSequenceAnalyticsError);
    const rest = createFallbackRestMock();

    const result = await callSequenceMetricsTool({ graphql, rest });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      result: {
        sequence: expect.objectContaining({ id: 'sequence-id' }),
        enrollments_by_status: { data: { REPLIED: 1, COMPLETED: 1 } },
        analytics: {
          enrolledCount: 2,
          contactedCount: 2,
          sentEmailCount: 2,
          repliedCount: 1,
          completedCount: 1,
          failedCount: 0,
          replyRate: 50,
          emailVariants: [
            {
              stepId: 'email-step-id',
              stepName: 'Introduction',
              variantId: 'variant-a',
              variantName: 'A',
              sentCount: 1,
              repliedCount: 1,
              replyRate: 100,
            },
            {
              stepId: 'email-step-id',
              stepName: 'Introduction',
              variantId: 'variant-b',
              variantName: 'B',
              sentCount: 1,
              repliedCount: 0,
              replyRate: 0,
            },
          ],
        },
      },
    });
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining('sequenceAnalytics'),
      { sequenceId: 'sequence-id' },
      { endpoint: 'metadata' },
    );
    expect(rest).toHaveBeenCalledWith(
      'GET',
      '/rest/sequenceEnrollments/groupBy',
      expect.objectContaining({
        query: expect.objectContaining({
          aggregate: ['countNotEmptyId'],
        }),
      }),
    );
    expect(rest).toHaveBeenCalledWith(
      'GET',
      '/rest/sequenceEnrollments',
      expect.objectContaining({
        query: expect.objectContaining({
          starting_after: 'enrollment-cursor',
        }),
      }),
    );
  });

  it('does not mask unrelated GraphQL failures with the REST fallback', async () => {
    const graphql = jest.fn().mockRejectedValue(
      new TwentyApiError({
        message: 'Sequence analytics service failed.',
        code: 'GRAPHQL_ERROR',
      }),
    );
    const rest = createFallbackRestMock();

    const result = await callSequenceMetricsTool({ graphql, rest });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('Sequence analytics service failed.'),
        }),
      ]),
    );
    expect(
      rest.mock.calls.some(
        ([, path]) =>
          path === '/rest/sequenceSteps' ||
          path === '/rest/sequenceEnrollments',
      ),
    ).toBe(false);
  });
});
