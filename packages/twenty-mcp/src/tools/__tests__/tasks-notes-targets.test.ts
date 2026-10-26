import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import type { MetadataObject } from '../../types.js';
import { registerTaskAndNoteTools } from '../tasks-notes.tools.js';

const customObject: MetadataObject = {
  id: 'case-object-id',
  nameSingular: 'caseFile',
  namePlural: 'caseFiles',
  labelSingular: 'Case',
  labelPlural: 'Cases',
  fields: [],
};
const targetObject = (
  name: string,
  morph: boolean | 'physical',
): MetadataObject => ({
  id: `${name}-id`,
  nameSingular: `${name}Target`,
  namePlural: `${name}Targets`,
  labelSingular: `${name} target`,
  labelPlural: `${name} targets`,
  fields: [
    { id: `${name}-field-id`, name, label: name, type: 'RELATION' },
    morph === true
      ? {
          id: 'target-id',
          name: 'target',
          label: 'Target',
          type: 'MORPH_RELATION',
          morphRelations: [
            {
              targetObjectMetadata: {
                id: customObject.id,
                nameSingular: 'caseFile',
              },
            },
          ],
        }
      : {
          id: 'target-id',
          name: 'targetCaseFile',
          label: 'Case',
          type: morph === 'physical' ? 'MORPH_RELATION' : 'RELATION',
        },
  ],
});

const withClient = async (
  morph: boolean | 'physical',
  operation: (
    client: Client,
    rest: jest.Mock,
    objects: MetadataObject[],
    metadata: MetadataService,
  ) => Promise<void>,
) => {
  const objects = [
    customObject,
    targetObject('note', morph),
    targetObject('task', morph),
    {
      ...targetObject('timelineActivity', morph),
      nameSingular: 'timelineActivity',
      namePlural: 'timelineActivities',
    },
  ];
  const rest = jest.fn(async (method: string, path: string) =>
    path === '/rest/metadata/objects'
      ? { data: { objects } }
      : method === 'GET'
        ? { data: [] }
        : { data: { id: 'join-id' } },
  );
  const apiClient = { rest } as unknown as TwentyClient;
  const metadata = new MetadataService(apiClient, 60_000);
  const server = new McpServer({
    name: 'activity-target-test',
    version: '1.0.0',
  });
  registerTaskAndNoteTools(server, {
    client: apiClient,
    metadata,
    enableAdvanced: false,
  });
  const client = new Client({ name: 'target-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    await operation(client, rest, objects, metadata);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe.each([false, true, 'physical' as const])(
  'custom activity targets (morph=%s)',
  (morph) => {
    it.each(['task', 'note'])(
      'attaches a %s using the canonical custom singular name',
      async (kind) => {
        await withClient(morph, async (client, rest) => {
          const result = await client.callTool({
            name: `twenty_attach_${kind}`,
            arguments: {
              [`${kind}_id`]: 'activity-id',
              target_object: 'caseFiles',
              target_record_id: 'record-id',
            },
          });
          expect(result.isError).not.toBe(true);
          expect(rest).toHaveBeenCalledWith('POST', `/rest/${kind}Targets`, {
            query: { depth: 0 },
            token: undefined,
            body: {
              [`${kind}Id`]: 'activity-id',
              targetCaseFileId: 'record-id',
            },
          });
        });
      },
    );

    it('refuses unsupported targets before creating a join', async () => {
      await withClient(morph, async (client, rest, objects) => {
        objects[1]!.fields = [];
        const result = await client.callTool({
          name: 'twenty_attach_task',
          arguments: {
            task_id: 'activity-id',
            target_object: 'caseFiles',
            target_record_id: 'record-id',
          },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          result: {
            error: expect.stringContaining(
              'does not support both note and task targets',
            ),
          },
        });
        expect(rest.mock.calls.every(([method]) => method === 'GET')).toBe(
          true,
        );
      });
    });
  },
);

it('uses the canonical custom target in activity queries', async () => {
  await withClient(false, async (client, rest) => {
    const result = await client.callTool({
      name: 'twenty_list_activities',
      arguments: {
        target_object: 'caseFiles',
        target_record_id: 'record-id',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(rest).toHaveBeenCalledWith(
      'GET',
      '/rest/taskTargets',
      expect.objectContaining({
        query: expect.objectContaining({
          filter: 'targetCaseFileId[eq]:"record-id"',
        }),
      }),
    );
  });
});
