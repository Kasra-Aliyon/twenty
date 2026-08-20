import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { registerSequenceTools } from '../sequences.tools.js';

describe('sequence atomic patch compatibility', () => {
  it('refuses a sparse settings patch when the backend lacks the protocol', async () => {
    const graphql = jest
      .fn()
      .mockRejectedValue(
        new Error('Cannot query field sequenceMutationCapabilities'),
      );
    const rest = jest.fn();
    const server = new McpServer({
      name: 'twenty-sequence-atomic-patch-test-server',
      version: '1.0.0',
    });

    registerSequenceTools(server, {
      client: {
        graphql,
        hasUserToken: () => false,
        rest,
      } as unknown as TwentyClient,
      metadata: {} as MetadataService,
      enableAdvanced: false,
    });

    const client = new Client({
      name: 'twenty-sequence-atomic-patch-test-client',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.callTool({
        name: 'twenty_update_sequence',
        arguments: {
          sequence_id: 'a7d9a42d-a8c9-4eaf-892f-57f6626225cb',
          settings: { stopOnReply: false },
          response_format: 'json',
        },
      });
      const appendResult = await client.callTool({
        name: 'twenty_add_sequence_step',
        arguments: {
          sequence_id: 'a7d9a42d-a8c9-4eaf-892f-57f6626225cb',
          step: {
            type: 'DELAY',
            settings: { days: 1 },
          },
          response_format: 'json',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        result: {
          error: expect.stringContaining(
            'does not advertise concurrency-safe sequence patches',
          ),
        },
      });
      expect(appendResult.isError).toBe(true);
      expect(appendResult.structuredContent).toEqual({
        result: {
          error: expect.stringContaining(
            'does not advertise concurrency-safe sequence patches',
          ),
        },
      });
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('sequenceMutationCapabilities'),
        {},
        { endpoint: 'metadata' },
      );
      expect(graphql).toHaveBeenCalledTimes(2);
      expect(rest).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
