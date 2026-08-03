import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../server.js';
import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';

const THREAD_ID = 'fc5e0382-3f02-4c84-986d-f762e9f51186';

const callTwentyTool = async ({
  arguments: toolArguments,
  graphqlResult = {},
  hasUserToken = true,
  name,
  restResult = {
    data: {
      linkedinMessageThreads: {
        id: THREAD_ID,
        messages: [],
        participants: [],
      },
    },
  },
}: {
  arguments: Record<string, unknown>;
  graphqlResult?: Record<string, unknown>;
  hasUserToken?: boolean;
  name: string;
  restResult?: unknown;
}) => {
  const graphql = jest.fn().mockResolvedValue(graphqlResult);
  const rest = jest.fn().mockResolvedValue(restResult);
  const getObject = jest.fn().mockImplementation(async (object: string) => ({
    namePlural: object,
  }));
  const server = createMcpServer({
    client: {
      graphql,
      hasUserToken: () => hasUserToken,
      rest,
    } as unknown as TwentyClient,
    metadata: { getObject } as unknown as MetadataService,
    enableAdvanced: false,
  });
  const client = new Client({
    name: 'twenty-linkedin-unibox-test-client',
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
      getObject,
      graphql,
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

describe('LinkedIn and Unibox MCP authentication', () => {
  it('searches LinkedIn Unibox threads with a user token', async () => {
    const graphqlResult = {
      uniboxThreads: {
        totalCount: 1,
        threads: [{ id: THREAD_ID, subject: 'Katrin Zaragoza' }],
      },
    };
    const { graphql, result } = await callTwentyTool({
      name: 'twenty_unibox_list_threads',
      arguments: {
        channel: 'LINKEDIN',
        search: 'Katrin Zaragoza',
        response_format: 'json',
      },
      graphqlResult,
    });

    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining('query TwentyMcpUniboxThreads'),
      {
        input: expect.objectContaining({
          channel: 'LINKEDIN',
          folder: 'INBOX',
          search: 'Katrin Zaragoza',
        }),
      },
      { token: 'user' },
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ result: graphqlResult });
  });

  it('returns explicit guidance when Unibox has no user token', async () => {
    const { graphql, result } = await callTwentyTool({
      name: 'twenty_unibox_list_threads',
      arguments: { channel: 'LINKEDIN' },
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

  it.each(['twenty_get_linkedin_thread', 'twenty_unibox_get_thread'])(
    'reads a LinkedIn thread with user auth and REST depth 1 through %s',
    async (name) => {
      const { rest, result } = await callTwentyTool({
        name,
        arguments:
          name === 'twenty_unibox_get_thread'
            ? { channel: 'LINKEDIN', thread_id: THREAD_ID }
            : { thread_id: THREAD_ID },
      });

      expect(rest).toHaveBeenCalledWith(
        'GET',
        `/rest/linkedinMessageThreads/${THREAD_ID}`,
        {
          query: { depth: 1 },
          token: 'user',
        },
      );
      expect(result.isError).not.toBe(true);
    },
  );

  it('lists owned LinkedIn threads using the record field name', async () => {
    const { rest, result } = await callTwentyTool({
      name: 'twenty_list_linkedin_threads',
      arguments: {},
      restResult: {
        data: { linkedinMessageThreads: [] },
        totalCount: 0,
      },
    });

    expect(rest).toHaveBeenCalledWith(
      'GET',
      '/rest/linkedinMessageThreads',
      expect.objectContaining({
        query: expect.objectContaining({
          depth: 0,
          order_by: 'lastMessageTime[DescNullsLast]',
        }),
        token: 'user',
      }),
    );
    expect(result.isError).not.toBe(true);
  });

  it('rejects unsupported LinkedIn REST depth before making a request', async () => {
    const { rest, result } = await callTwentyTool({
      name: 'twenty_get_linkedin_thread',
      arguments: { thread_id: THREAD_ID, depth: 2 },
    });

    expect(rest).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it('does not attempt a LinkedIn record read without a user token', async () => {
    const { rest, result } = await callTwentyTool({
      name: 'twenty_get_linkedin_thread',
      arguments: { thread_id: THREAD_ID },
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
});
