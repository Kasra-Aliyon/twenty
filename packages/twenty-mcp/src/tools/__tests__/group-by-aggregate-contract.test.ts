import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { registerOpportunityTools } from '../opportunities.tools.js';

describe('REST group-by aggregate contracts', () => {
  it('uses the supported non-empty ID count for opportunity pipeline totals', async () => {
    const rest = jest.fn().mockResolvedValue([]);
    const getObject = jest.fn().mockImplementation(async (object: string) => ({
      namePlural: object,
    }));
    const server = new McpServer({
      name: 'twenty-group-by-contract-test-server',
      version: '1.0.0',
    });

    registerOpportunityTools(server, {
      client: {
        rest,
      } as unknown as TwentyClient,
      metadata: { getObject } as unknown as MetadataService,
      enableAdvanced: false,
    });

    const client = new Client({
      name: 'twenty-group-by-contract-test-client',
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
        name: 'twenty_get_pipeline',
        arguments: { response_format: 'json' },
      });

      expect(result.isError).not.toBe(true);
      expect(rest).toHaveBeenCalledWith(
        'GET',
        '/rest/opportunities/groupBy',
        expect.objectContaining({
          query: expect.objectContaining({
            aggregate: ['countNotEmptyId', 'sumAmountAmountMicros'],
          }),
        }),
      );
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
