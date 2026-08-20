import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { STANDARD_OBJECTS } from '../../constants.js';
import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { registerRecordTools } from '../records.tools.js';

const SEQUENCE_ENGINE_OBJECT_NAMES = [
  STANDARD_OBJECTS.sequences,
  STANDARD_OBJECTS.sequenceSteps,
  STANDARD_OBJECTS.sequenceEnrollments,
  'sequence',
  'sequenceStep',
  'sequenceEnrollment',
];

type GenericMutationCase = {
  label: string;
  name: string;
  buildArguments: (objectName: string) => Record<string, unknown>;
};

const GENERIC_MUTATION_CASES: GenericMutationCase[] = [
  {
    label: 'create',
    name: 'twenty_create_record',
    buildArguments: (objectName) => ({ object: objectName, data: {} }),
  },
  {
    label: 'update',
    name: 'twenty_update_record',
    buildArguments: (objectName) => ({
      object: objectName,
      id: 'record-id',
      data: {},
    }),
  },
  {
    label: 'soft delete',
    name: 'twenty_delete_record',
    buildArguments: (objectName) => ({
      object: objectName,
      id: 'record-id',
      confirm: true,
    }),
  },
  {
    label: 'restore',
    name: 'twenty_restore_record',
    buildArguments: (objectName) => ({
      object: objectName,
      id: 'record-id',
    }),
  },
  {
    label: 'batch create',
    name: 'twenty_batch_create_records',
    buildArguments: (objectName) => ({
      object: objectName,
      data: [{}],
      confirm: true,
    }),
  },
  {
    label: 'merge',
    name: 'twenty_merge_records',
    buildArguments: (objectName) => ({
      object: objectName,
      ids: ['first-record-id', 'second-record-id'],
      conflict_priority_index: 0,
      dry_run: false,
      confirm: true,
    }),
  },
  {
    label: 'permanent destroy',
    name: 'twenty_destroy_record',
    buildArguments: (objectName) => ({
      object: objectName,
      id: 'record-id',
      confirm: true,
    }),
  },
];

const withMcpClient = async <TResult>(
  operation: ({
    client,
    getObject,
    rest,
  }: {
    client: Client;
    getObject: jest.Mock;
    rest: jest.Mock;
  }) => Promise<TResult>,
): Promise<TResult> => {
  const rest = jest.fn();
  const getObject = jest.fn();
  const dependencies = {
    client: {
      rest,
      hasUserToken: () => false,
    } as unknown as TwentyClient,
    metadata: { getObject } as unknown as MetadataService,
    enableAdvanced: true,
  };
  const server = new McpServer({
    name: 'twenty-record-sequence-guard-test-server',
    version: '1.0.0',
  });

  registerRecordTools(server, dependencies);
  const client = new Client({
    name: 'twenty-record-sequence-guard-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    return await operation({ client, getObject, rest });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe('generic record sequence mutation guard', () => {
  it.each(GENERIC_MUTATION_CASES)(
    'blocks generic $label for every sequence engine object alias',
    async ({ name, buildArguments }) => {
      await withMcpClient(async ({ client, getObject, rest }) => {
        for (const objectName of SEQUENCE_ENGINE_OBJECT_NAMES) {
          const result = await client.callTool({
            name,
            arguments: buildArguments(objectName),
          });

          expect(result.isError).toBe(true);
          expect(result.content).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining(
                  'Generic record mutations are disabled for sequences',
                ),
              }),
            ]),
          );
        }

        expect(getObject).not.toHaveBeenCalled();
        expect(rest).not.toHaveBeenCalled();
      });
    },
  );

  it('keeps generic sequence reads available', async () => {
    await withMcpClient(async ({ client, getObject, rest }) => {
      getObject.mockResolvedValue({ namePlural: STANDARD_OBJECTS.sequences });
      rest.mockResolvedValue({ data: { id: 'sequence-id', name: 'Sequence' } });

      const result = await client.callTool({
        name: 'twenty_get_record',
        arguments: {
          object: STANDARD_OBJECTS.sequences,
          id: 'sequence-id',
          response_format: 'json',
        },
      });

      expect(result.isError).not.toBe(true);
      expect(getObject).toHaveBeenCalledWith(STANDARD_OBJECTS.sequences);
      expect(rest).toHaveBeenCalledWith(
        'GET',
        '/rest/sequences/sequence-id',
        expect.objectContaining({ query: { depth: 0 } }),
      );
    });
  });
});
