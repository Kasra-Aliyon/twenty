import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../server.js';
import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';

const callLinkedinSearchTool = async ({
  arguments: toolArguments,
  hasUserToken = true,
  name,
  restResults = {},
}: {
  arguments: Record<string, unknown>;
  hasUserToken?: boolean;
  name: string;
  restResults?: Record<string, unknown>;
}) => {
  const rest = jest
    .fn()
    .mockImplementation(async (_method: string, path: string) => {
      return (
        restResults[path] ?? {
          data: {},
          totalCount: 0,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
        }
      );
    });
  const getObject = jest.fn().mockImplementation(async (object: string) => ({
    namePlural: object,
  }));
  const server = createMcpServer({
    client: {
      hasUserToken: () => hasUserToken,
      rest,
    } as unknown as TwentyClient,
    metadata: { getObject } as unknown as MetadataService,
    enableAdvanced: false,
  });
  const client = new Client({
    name: 'twenty-linkedin-search-test-client',
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
      rest,
      result: await client.callTool({
        name,
        arguments: toolArguments,
      }),
    };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe('LinkedIn MCP search tools', () => {
  it('resolves a contact to threads before searching outbound message bodies', async () => {
    const { rest, result } = await callLinkedinSearchTool({
      name: 'twenty_search_linkedin_messages',
      arguments: {
        search: 'publication plan',
        contact: 'Katrin Zaragoza',
        direction: 'OUTBOUND',
        date_from: '2026-08-01T00:00:00.000Z',
        date_to: '2026-08-13T23:59:59.000Z',
        starting_after: 'message-cursor',
        response_format: 'json',
      },
      restResults: {
        '/rest/linkedinThreadParticipants': {
          data: {
            linkedinThreadParticipants: [{ threadId: 'thread-1' }],
          },
          totalCount: 1,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: 'participant-start',
            endCursor: 'participant-end',
          },
        },
        '/rest/linkedinMessages': {
          data: {
            linkedinMessages: [
              {
                id: 'message-1',
                body: 'Here is the publication plan.',
                threadId: 'thread-1',
              },
            ],
          },
          totalCount: 1,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: 'message-start',
            endCursor: 'message-end',
          },
        },
      },
    });

    expect(rest).toHaveBeenNthCalledWith(
      1,
      'GET',
      '/rest/linkedinThreadParticipants',
      expect.objectContaining({
        query: expect.objectContaining({
          depth: 0,
          filter: expect.stringContaining('name[ilike]:"%Katrin Zaragoza%"'),
        }),
        token: 'user',
      }),
    );
    expect(rest).toHaveBeenNthCalledWith(
      2,
      'GET',
      '/rest/linkedinMessages',
      expect.objectContaining({
        query: expect.objectContaining({
          depth: 0,
          filter: expect.stringContaining('threadId[in]:["thread-1"]'),
          order_by: 'deliveredAt[DescNullsLast]',
          starting_after: 'message-cursor',
        }),
        token: 'user',
      }),
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ count: 1 }),
      }),
    );
  });

  it('does not search private LinkedIn records without a user token', async () => {
    const { rest, result } = await callLinkedinSearchTool({
      name: 'twenty_search_linkedin_connections',
      arguments: { contact: 'Katrin' },
      hasUserToken: false,
    });

    expect(rest).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('TWENTY_USER_TOKEN'),
        }),
      ]),
    );
  });

  it('searches sent invitations and outbound messages in one time window', async () => {
    const { rest, result } = await callLinkedinSearchTool({
      name: 'twenty_search_linkedin_activity',
      arguments: {
        types: ['MESSAGES', 'INVITATIONS'],
        direction: 'OUTBOUND',
        date_from: '2026-08-01T00:00:00.000Z',
        date_to: '2026-08-13T23:59:59.000Z',
        limit_per_type: 50,
        response_format: 'json',
      },
      restResults: {
        '/rest/linkedinMessages': {
          data: { linkedinMessages: [] },
          totalCount: 0,
        },
        '/rest/linkedinInvitations': {
          data: { linkedinInvitations: [] },
          totalCount: 0,
        },
      },
    });

    expect(rest).toHaveBeenCalledTimes(2);
    expect(rest).toHaveBeenCalledWith(
      'GET',
      '/rest/linkedinMessages',
      expect.objectContaining({
        query: expect.objectContaining({
          filter: expect.stringContaining('direction[eq]:"OUTBOUND"'),
          limit: 50,
        }),
        token: 'user',
      }),
    );
    expect(rest).toHaveBeenCalledWith(
      'GET',
      '/rest/linkedinInvitations',
      expect.objectContaining({
        query: expect.objectContaining({
          filter: expect.stringContaining('direction[eq]:"SENT"'),
          limit: 50,
        }),
        token: 'user',
      }),
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          direction: 'OUTBOUND',
          sources: expect.objectContaining({
            messages: expect.objectContaining({ count: 0 }),
            invitations: expect.objectContaining({ count: 0 }),
          }),
        }),
      }),
    );
  });
});
