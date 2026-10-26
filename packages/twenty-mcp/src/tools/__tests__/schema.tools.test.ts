import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TwentyApiError } from '../../services/errors.js';
import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import type { MetadataObject } from '../../types.js';
import { registerSchemaTools } from '../schema.tools.js';

const customObject: MetadataObject = {
  id: 'case-object-id',
  nameSingular: 'caseFile',
  namePlural: 'caseFiles',
  labelSingular: 'Case',
  labelPlural: 'Cases',
  isSystem: false,
  fields: [
    {
      id: 'name-field-id',
      name: 'name',
      label: 'Name',
      type: 'TEXT',
      isSystem: true,
    },
    {
      id: 'status-field-id',
      name: 'status',
      label: 'Status',
      type: 'SELECT',
      defaultValue: "'OPEN'",
      options: [
        {
          id: 'open-option-id',
          value: 'OPEN',
          label: 'Open',
          color: 'green',
          position: 0,
        },
        {
          id: 'closed-option-id',
          value: 'CLOSED',
          label: 'Closed',
          color: 'red',
          position: 1,
        },
      ],
    },
  ],
};
const personObject: MetadataObject = {
  ...customObject,
  id: 'person-object-id',
  nameSingular: 'person',
  namePlural: 'people',
};

const withClient = async (
  operation: (context: {
    client: Client;
    graphql: jest.Mock;
    rest: jest.Mock;
    clearCache: jest.Mock;
    getObject: jest.Mock;
    isCustomObject: jest.Mock;
  }) => Promise<void>,
) => {
  const graphql = jest.fn();
  const rest = jest.fn();
  const clearCache = jest.fn();
  const getObject = jest.fn(async (name: string) =>
    name === 'people' || name === 'person' ? personObject : customObject,
  );
  const isCustomObject = jest.fn(
    async (object: MetadataObject) => object.id === customObject.id,
  );
  const server = new McpServer({ name: 'schema-tools-test', version: '1.0.0' });
  registerSchemaTools(server, {
    client: { graphql, rest } as unknown as TwentyClient,
    metadata: {
      getObject,
      isCustomObject,
      clearCache,
    } as unknown as MetadataService,
    enableAdvanced: false,
  });
  const client = new Client({ name: 'schema-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    await operation({
      client,
      graphql,
      rest,
      clearCache,
      getObject,
      isCustomObject,
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

const objectArguments = {
  name_singular: 'caseFile',
  name_plural: 'caseFiles',
  label_singular: 'Case',
  label_plural: 'Cases',
  icon: 'IconFolder',
};
const cases = [
  {
    name: 'twenty_create_object',
    mutation: 'createOneObject',
    inputType: 'CreateOneObjectInput',
    args: objectArguments,
    input: {
      object: {
        nameSingular: 'caseFile',
        namePlural: 'caseFiles',
        labelSingular: 'Case',
        labelPlural: 'Cases',
        icon: 'IconFolder',
        isLabelSyncedWithName: false,
      },
    },
  },
  {
    name: 'twenty_update_object',
    mutation: 'updateOneObject',
    inputType: 'UpdateOneObjectInput',
    args: { object: 'caseFiles', changes: { label_plural: 'Case files' } },
    input: {
      id: 'case-object-id',
      update: { labelPlural: 'Case files', isLabelSyncedWithName: false },
    },
  },
  {
    name: 'twenty_create_field',
    mutation: 'createOneField',
    inputType: 'CreateOneFieldMetadataInput',
    args: {
      object: 'people',
      name: 'reference',
      label: 'Reference',
      type: 'TEXT',
    },
    input: {
      field: {
        objectMetadataId: 'person-object-id',
        name: 'reference',
        label: 'Reference',
        type: 'TEXT',
        isActive: true,
        isNullable: true,
        isLabelSyncedWithName: false,
      },
    },
  },
  {
    name: 'twenty_update_field',
    mutation: 'updateOneField',
    inputType: 'UpdateOneFieldMetadataInput',
    args: { object: 'caseFiles', field: 'name', changes: { label: 'Subject' } },
    input: {
      id: 'name-field-id',
      update: { label: 'Subject', isLabelSyncedWithName: false },
    },
  },
];

describe('schema tools', () => {
  it.each(cases)(
    'previews $name without sending a mutation',
    async ({ name, args, mutation, input }) => {
      await withClient(async ({ client, graphql, rest, clearCache }) => {
        const result = await client.callTool({
          name,
          arguments: { ...args, confirm: false },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual({
          result: { confirmed: false, mutation, input },
        });
        expect(graphql).not.toHaveBeenCalled();
        expect(rest).not.toHaveBeenCalled();
        expect(clearCache).not.toHaveBeenCalled();
      });
    },
  );

  it.each(cases)(
    'sends the exact previewed input for confirmed $name and invalidates metadata',
    async ({ name, args, mutation, inputType, input }) => {
      await withClient(async ({ client, graphql, clearCache }) => {
        graphql.mockResolvedValue({ [mutation]: { id: 'created-id' } });
        const result = await client.callTool({
          name,
          arguments: { ...args, confirm: true },
        });
        expect(result.isError).not.toBe(true);
        expect(graphql).toHaveBeenCalledWith(
          expect.stringContaining(`$input: ${inputType}!`),
          { input },
          { endpoint: 'metadata' },
        );
        expect(graphql).toHaveBeenCalledTimes(1);
        expect(clearCache).toHaveBeenCalledTimes(1);
      });
    },
  );

  it('defaults to preview and maps ordered select options and their default', async () => {
    await withClient(async ({ client, graphql }) => {
      const result = await client.callTool({
        name: 'twenty_create_field',
        arguments: {
          object: 'caseFiles',
          name: 'priority',
          label: 'Priority',
          type: 'SELECT',
          options: [
            { value: 'HIGH', label: 'High', color: 'red' },
            { value: 'LOW', label: 'Low' },
          ],
          default_value: 'LOW',
        },
      });
      expect(result.structuredContent).toMatchObject({
        result: {
          confirmed: false,
          input: {
            field: {
              options: [
                { value: 'HIGH', label: 'High', color: 'red', position: 0 },
                { value: 'LOW', label: 'Low', color: 'gray', position: 1 },
              ],
              defaultValue: "'LOW'",
            },
          },
        },
      });
      expect(graphql).not.toHaveBeenCalled();
    });
  });

  it.each(['MANY_TO_ONE', 'ONE_TO_MANY'])(
    'resolves relation ids and maps %s inverse fields',
    async (type) => {
      await withClient(async ({ client, getObject }) => {
        const result = await client.callTool({
          name: 'twenty_create_field',
          arguments: {
            object: 'caseFiles',
            name: 'owner',
            label: 'Owner',
            type: 'RELATION',
            relation: { target_object: 'people', type, inverse_label: 'Cases' },
          },
        });
        expect(getObject).toHaveBeenCalledWith('people');
        expect(result.structuredContent).toMatchObject({
          result: {
            input: {
              field: {
                objectMetadataId: 'case-object-id',
                relationCreationPayload: {
                  targetObjectMetadataId: 'person-object-id',
                  type,
                  targetFieldLabel: 'Cases',
                  targetFieldIcon: 'IconLink',
                },
              },
            },
          },
        });
      });
    },
  );

  it('preserves select option ids and colors when labels and order change', async () => {
    await withClient(async ({ client }) => {
      const result = await client.callTool({
        name: 'twenty_update_field',
        arguments: {
          object: 'caseFiles',
          field: 'status',
          changes: {
            options: [
              { value: 'CLOSED', label: 'Finished' },
              { value: 'OPEN', label: 'Open' },
            ],
          },
        },
      });
      expect(result.structuredContent).toMatchObject({
        result: {
          input: {
            update: {
              options: [
                {
                  id: 'closed-option-id',
                  value: 'CLOSED',
                  label: 'Finished',
                  color: 'red',
                  position: 0,
                },
                {
                  id: 'open-option-id',
                  value: 'OPEN',
                  label: 'Open',
                  color: 'green',
                  position: 1,
                },
              ],
            },
          },
        },
      });
    });
  });

  it('refuses option removal until explicitly allowed and its old default is cleared', async () => {
    await withClient(async ({ client, graphql }) => {
      const args = {
        object: 'caseFiles',
        field: 'status',
        confirm: true,
        changes: { options: [{ value: 'CLOSED', label: 'Closed' }] },
      };
      const refused = await client.callTool({
        name: 'twenty_update_field',
        arguments: args,
      });
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent).toMatchObject({
        result: { error: expect.stringContaining('allow_option_removal=true') },
      });
      const invalidDefault = await client.callTool({
        name: 'twenty_update_field',
        arguments: { ...args, allow_option_removal: true },
      });
      expect(invalidDefault.isError).toBe(true);
      expect(graphql).not.toHaveBeenCalled();
      graphql.mockResolvedValue({ updateOneField: { id: 'status-field-id' } });
      const allowed = await client.callTool({
        name: 'twenty_update_field',
        arguments: {
          ...args,
          allow_option_removal: true,
          changes: { ...args.changes, default_value: null },
        },
      });
      expect(allowed.isError).not.toBe(true);
      expect(graphql).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    {
      name: 'twenty_update_object',
      args: { object: 'people', changes: { label_singular: 'Contact' } },
    },
    {
      name: 'twenty_update_field',
      args: {
        object: 'people',
        field: 'name',
        changes: { label: 'Contact', is_active: false },
      },
    },
  ])('protects standard objects from $name', async ({ name, args }) => {
    await withClient(async ({ client, graphql, clearCache }) => {
      const result = await client.callTool({
        name,
        arguments: { ...args, confirm: true },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        result: {
          error: expect.stringContaining(
            'Standard and installed-application objects are protected',
          ),
        },
      });
      expect(graphql).not.toHaveBeenCalled();
      expect(clearCache).not.toHaveBeenCalled();
    });
  });

  it.each([
    { type: 'SELECT', options: [{ value: 'bad-value', label: 'Bad' }] },
    {
      type: 'SELECT',
      options: [
        { value: 'OPEN', label: 'A' },
        { value: 'OPEN', label: 'B' },
      ],
    },
    {
      type: 'SELECT',
      options: [{ value: 'OPEN', label: 'Open' }],
      default_value: 'MISSING',
    },
    { type: 'SELECT' },
    { type: 'TEXT', options: [{ value: 'OPEN', label: 'Open' }] },
    { type: 'RELATION' },
  ])(
    'rejects invalid field configuration before writing: %j',
    async (changes) => {
      await withClient(async ({ client, graphql }) => {
        const result = await client.callTool({
          name: 'twenty_create_field',
          arguments: {
            object: 'caseFiles',
            name: 'priority',
            label: 'Priority',
            ...changes,
            confirm: true,
          },
        });
        expect(result.isError).toBe(true);
        expect(graphql).not.toHaveBeenCalled();
      });
    },
  );

  it('quotes multi-select defaults and reports unknown fields without writing', async () => {
    await withClient(async ({ client, graphql }) => {
      const preview = await client.callTool({
        name: 'twenty_create_field',
        arguments: {
          object: 'caseFiles',
          name: 'tags',
          label: 'Tags',
          type: 'MULTI_SELECT',
          options: [{ value: 'URGENT', label: 'Urgent' }],
          default_value: ['URGENT'],
        },
      });
      expect(preview.structuredContent).toMatchObject({
        result: { input: { field: { defaultValue: ["'URGENT'"] } } },
      });
      const missing = await client.callTool({
        name: 'twenty_update_field',
        arguments: {
          object: 'caseFiles',
          field: 'missing',
          changes: { label: 'Missing' },
          confirm: true,
        },
      });
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toMatchObject({
        result: { error: expect.stringContaining('Unknown field') },
      });
      expect(graphql).not.toHaveBeenCalled();
    });
  });

  it.each([
    new TwentyApiError({
      message: 'Forbidden: DATA_MODEL permission required',
      status: 403,
    }),
    new Error('Metadata service unavailable'),
  ])(
    'returns readable API failures and retains the metadata cache',
    async (error) => {
      await withClient(async ({ client, graphql, clearCache }) => {
        graphql.mockRejectedValue(error);
        const result = await client.callTool({
          name: 'twenty_create_object',
          arguments: { ...objectArguments, confirm: true },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          result: { error: error.message },
        });
        expect(clearCache).not.toHaveBeenCalled();
      });
    },
  );

  it('rejects an empty mutation result without claiming success', async () => {
    await withClient(async ({ client, graphql, clearCache }) => {
      graphql.mockResolvedValue({ createOneObject: null });
      const result = await client.callTool({
        name: 'twenty_create_object',
        arguments: { ...objectArguments, confirm: true },
      });
      expect(result.isError).toBe(true);
      expect(clearCache).not.toHaveBeenCalled();
    });
  });
});
