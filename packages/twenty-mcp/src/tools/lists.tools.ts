import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { combineFilters, filterCondition } from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import type { ToolDependencies } from '../types.js';

const listTypeSchema = z.enum(['COMPANY', 'PERSON', 'OPPORTUNITY']);
const listTargetSchema = z.enum(['company', 'person', 'opportunity']);

const targetIdField = (object: 'company' | 'opportunity' | 'person'): string =>
  `target${object[0]?.toLocaleUpperCase()}${object.slice(1)}Id`;

const extractIds = (items: unknown[]): string[] =>
  items
    .map((item) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof item.id === 'string'
      ) {
        return item.id;
      }

      return undefined;
    })
    .filter((id): id is string => id !== undefined);

export const registerListTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_list_lists',
    {
      title: 'List CRM lists',
      description: 'Lists record lists with optional type filtering.',
      inputSchema: z.object({
        type: listTypeSchema.optional(),
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ type, limit, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.recordLists,
            filter:
              type === undefined
                ? undefined
                : filterCondition('type', 'eq', type),
            limit,
            depth: 1,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_create_list',
    {
      title: 'Create a CRM list',
      description: 'Creates a person, company, or opportunity list.',
      inputSchema: z.object({
        name: z.string().min(1),
        type: listTypeSchema,
        folder_id: z.string().nullable().optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ name, type, folder_id, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.recordLists,
            data: {
              name,
              type,
              ...(folder_id === undefined ? {} : { folderId: folder_id }),
            },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_list',
    {
      title: 'Get a CRM list',
      description: 'Gets a list and its members with resolved target records.',
      inputSchema: z.object({
        list_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ list_id, response_format }) =>
      runTool(
        () =>
          records.get({
            object: STANDARD_OBJECTS.recordLists,
            id: list_id,
            depth: 2,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_add_record_to_list',
    {
      title: 'Add a record to a list',
      description:
        'Adds a person, company, or opportunity to a compatible CRM list.',
      inputSchema: z.object({
        list_id: recordIdSchema,
        record_object: listTargetSchema,
        record_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ list_id, record_object, record_id, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.recordListMembers,
            data: {
              recordListId: list_id,
              [targetIdField(record_object)]: record_id,
            },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_remove_record_from_list',
    {
      title: 'Remove a record from a list',
      description:
        'Finds and soft-deletes the matching list membership. Requires explicit confirmation.',
      inputSchema: z.object({
        list_id: recordIdSchema,
        record_object: listTargetSchema,
        record_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ list_id, record_object, record_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'List removal not performed: confirm must be true after explicit user confirmation.',
          );
        }

        const memberships = await records.list({
          object: STANDARD_OBJECTS.recordListMembers,
          filter: combineFilters('and', [
            filterCondition('recordListId', 'eq', list_id),
            filterCondition(targetIdField(record_object), 'eq', record_id),
          ]),
          limit: 10,
        });
        const membershipIds = extractIds(memberships.items);

        if (membershipIds.length === 0) {
          return { removed: false, reason: 'Membership not found.' };
        }

        const removed = await Promise.all(
          membershipIds.map((id) =>
            records.softDelete(STANDARD_OBJECTS.recordListMembers, id),
          ),
        );

        return {
          removed: true,
          membership_ids: membershipIds,
          results: removed,
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_list_folders',
    {
      title: 'List CRM list folders',
      description: 'Lists folders that organize CRM lists.',
      inputSchema: z.object({
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.recordListFolders,
            limit,
            depth: 1,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_create_folder',
    {
      title: 'Create a CRM list folder',
      description: 'Creates a folder for organizing CRM lists.',
      inputSchema: z.object({
        name: z.string().min(1),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ name, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.recordListFolders,
            data: { name },
          }),
        response_format,
      ),
  );
};

export const listsToolsTesting = { extractIds, targetIdField };
