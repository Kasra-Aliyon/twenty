import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runTool } from '../formatting/format-tool-result.js';
import {
  listLimitSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import type { ToolDependencies } from '../types.js';

const SEARCH_QUERY = `
  query TwentyMcpSearch(
    $searchInput: String!
    $limit: Int!
    $after: String
    $includedObjectNameSingulars: [String!]
    $excludedObjectNameSingulars: [String!]
  ) {
    search(
      searchInput: $searchInput
      limit: $limit
      after: $after
      includedObjectNameSingulars: $includedObjectNameSingulars
      excludedObjectNameSingulars: $excludedObjectNameSingulars
    ) {
      edges {
        cursor
        node {
          recordId
          objectNameSingular
          objectLabelSingular
          label
          imageUrl
          tsRank
          tsRankCD
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

export const registerDiscoveryTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  server.registerTool(
    'twenty_health_check',
    {
      title: 'Check Twenty MCP health',
      description:
        'Checks local MCP configuration and verifies that Twenty metadata is reachable.',
      inputSchema: z.object({
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ response_format }) =>
      runTool(async () => {
        const objects = await dependencies.metadata.listObjects();

        return {
          status: 'ok',
          object_count: objects.length,
          unibox_user_token_configured: dependencies.client.hasUserToken(),
          advanced_tools_enabled: dependencies.enableAdvanced,
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_list_objects',
    {
      title: 'List Twenty objects',
      description:
        'Lists standard and custom CRM objects. Use each name_plural value as the object argument to generic record tools.',
      inputSchema: z.object({
        include_system: z.boolean().default(true),
        refresh: z
          .boolean()
          .default(false)
          .describe('Bypass and replace the metadata cache.'),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ include_system, refresh, response_format }) =>
      runTool(async () => {
        const objects = await dependencies.metadata.listObjects({ refresh });

        return objects
          .filter((object) => include_system || object.isSystem !== true)
          .map((object) => ({
            id: object.id,
            name_singular: object.nameSingular,
            name_plural: object.namePlural,
            label: object.labelPlural,
            description: object.description ?? null,
            icon: object.icon ?? null,
            is_system: object.isSystem ?? false,
            is_remote: object.isRemote ?? false,
            is_searchable: object.isSearchable ?? false,
          }));
      }, response_format),
  );

  server.registerTool(
    'twenty_describe_object',
    {
      title: 'Describe a Twenty object',
      description:
        'Returns the live field schema, enum values, defaults, and relations for one standard or custom object.',
      inputSchema: z.object({
        object: z
          .string()
          .min(1)
          .describe('Singular name or plural slug from twenty_list_objects.'),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ object, response_format }) =>
      runTool(async () => {
        const metadataObject = await dependencies.metadata.getObject(object);

        return {
          id: metadataObject.id,
          name_singular: metadataObject.nameSingular,
          name_plural: metadataObject.namePlural,
          label_singular: metadataObject.labelSingular,
          label_plural: metadataObject.labelPlural,
          description: metadataObject.description ?? null,
          is_system: metadataObject.isSystem ?? false,
          fields: metadataObject.fields.map((field) => ({
            id: field.id,
            name: field.name,
            relation_id_input:
              field.type === 'RELATION' || field.type === 'MORPH_RELATION'
                ? `${field.name}Id`
                : null,
            label: field.label,
            type: field.type,
            description: field.description ?? null,
            nullable: field.isNullable ?? null,
            editable: field.isUIEditable ?? null,
            system: field.isSystem ?? false,
            unique: field.isUnique ?? false,
            default: field.defaultValue ?? null,
            options: field.options ?? [],
            relation: field.relation ?? null,
            morph_relations: field.morphRelations ?? [],
          })),
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_refresh_metadata',
    {
      title: 'Refresh Twenty metadata',
      description:
        'Clears the local schema cache and reloads live object/field metadata.',
      inputSchema: z.object({
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ response_format }) =>
      runTool(async () => {
        dependencies.metadata.clearCache();
        const objects = await dependencies.metadata.listObjects({
          refresh: true,
        });

        return { refreshed: true, object_count: objects.length };
      }, response_format),
  );

  server.registerTool(
    'twenty_global_search',
    {
      title: 'Search Twenty',
      description:
        'Searches across searchable standard and custom objects and returns record IDs, labels, object types, and cursor pagination.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: listLimitSchema,
        after: z.string().optional(),
        include_objects: z
          .array(z.string())
          .optional()
          .describe('Singular object names to include.'),
        exclude_objects: z
          .array(z.string())
          .optional()
          .describe('Singular object names to exclude.'),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      query,
      limit,
      after,
      include_objects,
      exclude_objects,
      response_format,
    }) =>
      runTool(
        async () =>
          dependencies.client.graphql<unknown>(SEARCH_QUERY, {
            searchInput: query,
            limit,
            after: after ?? null,
            includedObjectNameSingulars: include_objects ?? null,
            excludedObjectNameSingulars: exclude_objects ?? null,
          }),
        response_format,
      ),
  );
};
