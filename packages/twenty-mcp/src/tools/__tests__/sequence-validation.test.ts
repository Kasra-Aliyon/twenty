import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { registerSequenceTools } from '../sequences.tools.js';

describe('sequence activation readiness tool', () => {
  it('returns exact backend blockers and non-mutating point-in-time warnings', async () => {
    const graphql = jest.fn().mockResolvedValue({
      sequenceReadiness: {
        ready: false,
        errors: [
          'Outreach sequences are disabled for this workspace',
          'Choose a sender before activating the sequence',
        ],
      },
    });
    const rest = jest.fn().mockResolvedValue({
      data: {
        sequenceSteps: [
          {
            id: 'branch-condition-id',
            position: 0,
            createdAt: '2026-08-20T08:00:00.000Z',
            settings: {
              type: 'CONDITION',
              condition: 'HAS_EMAIL_ADDRESS',
            },
          },
          {
            id: 'connection-step-id',
            position: 1,
            createdAt: '2026-08-20T08:01:00.000Z',
            settings: {
              type: 'SEND_CONNECTION_REQUEST',
              branch: {
                conditionStepId: 'branch-condition-id',
                outcome: 'YES',
              },
            },
          },
          {
            id: 'accepted-condition-id',
            position: 2,
            createdAt: '2026-08-20T08:02:00.000Z',
            settings: {
              type: 'CONDITION',
              condition: 'ACCEPTED_LINKEDIN_INVITE',
            },
          },
          {
            id: 'message-step-id',
            position: 3,
            createdAt: '2026-08-20T08:03:00.000Z',
            settings: { type: 'SEND_LINKEDIN_MESSAGE' },
          },
          {
            id: 'opened-condition-id',
            position: 4,
            createdAt: '2026-08-20T08:04:00.000Z',
            settings: {
              type: 'CONDITION',
              condition: 'OPENED_LINKEDIN_MESSAGE',
            },
          },
          {
            id: 'safe-connection-step-id',
            position: 5,
            createdAt: '2026-08-20T08:05:00.000Z',
            settings: { type: 'SEND_CONNECTION_REQUEST' },
          },
          {
            id: 'delay-step-id',
            position: 6,
            createdAt: '2026-08-20T08:06:00.000Z',
            settings: { type: 'DELAY', days: 1 },
          },
          {
            id: 'safe-accepted-condition-id',
            position: 7,
            createdAt: '2026-08-20T08:07:00.000Z',
            settings: {
              type: 'CONDITION',
              condition: 'ACCEPTED_LINKEDIN_INVITE',
            },
          },
        ],
      },
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        endCursor: 'step-cursor',
      },
    });
    const getObject = jest.fn().mockImplementation(async (object: string) => ({
      namePlural: object,
    }));
    const server = new McpServer({
      name: 'twenty-sequence-validation-test-server',
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
      name: 'twenty-sequence-validation-test-client',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const listedTools = await client.listTools();
      const validationTool = listedTools.tools.find(
        ({ name }) => name === 'twenty_validate_sequence',
      );
      const result = await client.callTool({
        name: 'twenty_validate_sequence',
        arguments: {
          sequence_id: 'sequence-id',
          response_format: 'json',
        },
      });

      expect(validationTool?.annotations).toEqual(
        expect.objectContaining({
          idempotentHint: true,
          readOnlyHint: true,
        }),
      );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        result: {
          ready: false,
          errors: [
            'Outreach sequences are disabled for this workspace',
            'Choose a sender before activating the sequence',
          ],
          warnings: [
            expect.stringContaining(
              'ACCEPTED_LINKEDIN_INVITE immediately after SEND_CONNECTION_REQUEST',
            ),
            expect.stringContaining(
              'OPENED_LINKEDIN_MESSAGE immediately after SEND_LINKEDIN_MESSAGE',
            ),
          ],
        },
      });
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('sequenceReadiness'),
        { sequenceId: 'sequence-id' },
        { endpoint: 'metadata' },
      );
      expect(rest).toHaveBeenCalledTimes(1);
      expect(rest).toHaveBeenCalledWith(
        'GET',
        '/rest/sequenceSteps',
        expect.objectContaining({
          query: expect.objectContaining({
            filter: expect.stringContaining('sequenceId'),
          }),
        }),
      );
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
