import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool } from '../formatting/format-tool-result.js';
import { TOOL_OUTPUT_SCHEMA } from '../schemas/common.schemas.js';
import {
  createFieldSchema,
  createObjectSchema,
  updateFieldSchema,
  updateObjectSchema,
} from '../schemas/schema-tools.schemas.js';
import type { MetadataObject, ToolDependencies } from '../types.js';
import {
  createFieldInput,
  createObjectInput,
  updateFieldInput,
  updateObjectInput,
} from './schema-input-builders.js';

const MUTATIONS = {
  createOneObject: {
    inputType: 'CreateOneObjectInput',
    fields:
      'id nameSingular namePlural labelSingular labelPlural description icon',
  },
  updateOneObject: {
    inputType: 'UpdateOneObjectInput',
    fields:
      'id nameSingular namePlural labelSingular labelPlural description icon',
  },
  createOneField: {
    inputType: 'CreateOneFieldMetadataInput',
    fields: 'id name label type description icon options defaultValue isActive',
  },
  updateOneField: {
    inputType: 'UpdateOneFieldMetadataInput',
    fields: 'id name label type description icon options defaultValue isActive',
  },
} as const;

export const registerSchemaTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const mutate = async (
    mutation: keyof typeof MUTATIONS,
    input: Record<string, unknown>,
    confirm: boolean,
  ) => {
    if (!confirm) {
      return { confirmed: false, mutation, input };
    }

    const definition = MUTATIONS[mutation];
    const response = await dependencies.client.graphql<
      Record<string, { id: string } | null>
    >(
      `mutation TwentyMcpSchemaChange($input: ${definition.inputType}!) {
        ${mutation}(input: $input) { ${definition.fields} }
      }`,
      { input },
      { endpoint: 'metadata' },
    );
    const result = response[mutation];

    if (!result?.id) {
      throw new Error(
        `No metadata was returned by ${mutation}. Refresh metadata before retrying.`,
      );
    }

    dependencies.metadata.clearCache();

    return { confirmed: true, mutation, input, metadata: result };
  };

  const assertCustomObject = async (object: MetadataObject) => {
    if (!(await dependencies.metadata.isCustomObject(object))) {
      throw new Error(
        'Only workspace-custom objects and their fields can be updated. Standard and installed-application objects are protected; new fields may still be added to them.',
      );
    }
  };

  server.registerTool(
    'twenty_create_object',
    {
      title: 'Create a custom object',
      description:
        'Requires DATA_MODEL permission. Returns the exact mutation input until confirm=true; then creates a workspace-custom object with its standard activity relations.',
      inputSchema: createObjectSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ response_format, ...input }) =>
      runTool(
        () =>
          mutate(
            'createOneObject',
            createObjectInput({ ...input, response_format }),
            input.confirm,
          ),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_object',
    {
      title: 'Update a custom object',
      description:
        'Requires DATA_MODEL permission. Previews or changes a workspace-custom object’s labels, description or icon. Standard and installed-application objects are protected.',
      inputSchema: updateObjectSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ object, changes, confirm, response_format }) =>
      runTool(async () => {
        const metadataObject = await dependencies.metadata.getObject(object);
        await assertCustomObject(metadataObject);

        return mutate(
          'updateOneObject',
          updateObjectInput(metadataObject, changes),
          confirm,
        );
      }, response_format),
  );

  server.registerTool(
    'twenty_create_field',
    {
      title: 'Create a field',
      description:
        'Requires DATA_MODEL permission. Previews or adds a field to any object. Relation targets and inverse labels are resolved from live metadata; select options retain the supplied order.',
      inputSchema: createFieldSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ response_format, ...input }) =>
      runTool(async () => {
        const metadataObject = await dependencies.metadata.getObject(
          input.object,
        );
        const target =
          input.relation === undefined
            ? undefined
            : await dependencies.metadata.getObject(
                input.relation.target_object,
              );

        return mutate(
          'createOneField',
          createFieldInput(
            { ...input, response_format },
            metadataObject,
            target,
          ),
          input.confirm,
        );
      }, response_format),
  );

  server.registerTool(
    'twenty_update_field',
    {
      title: 'Update a custom object field',
      description:
        'Requires DATA_MODEL permission. Previews or updates fields only on workspace-custom objects, including the built-in name field’s label. Dropping select options requires allow_option_removal=true because stored values are lost.',
      inputSchema: updateFieldSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
      },
    },
    async (input) =>
      runTool(async () => {
        const object = await dependencies.metadata.getObject(input.object);
        await assertCustomObject(object);
        const field = object.fields.find((entry) => entry.name === input.field);

        if (field === undefined) {
          throw new Error(
            `Unknown field "${input.field}" on ${object.nameSingular}. Use twenty_describe_object.`,
          );
        }

        return mutate(
          'updateOneField',
          updateFieldInput(field, input),
          input.confirm,
        );
      }, input.response_format),
  );
};
