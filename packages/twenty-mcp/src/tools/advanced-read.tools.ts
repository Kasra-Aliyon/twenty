import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  depthSchema,
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { filterCondition } from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import type { ToolDependencies } from '../types.js';

const targetSchema = z.object({
  target_object: z.enum(['company', 'person', 'opportunity', 'note', 'task']),
  target_record_id: recordIdSchema,
});

const targetField = (
  object: 'company' | 'note' | 'opportunity' | 'person' | 'task',
): string => `target${object[0]?.toLocaleUpperCase()}${object.slice(1)}Id`;

export const registerAdvancedReadTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_list_attachments',
    {
      title: 'List record attachments',
      description:
        'Lists file attachment records associated with a person, company, opportunity, note, or task. File upload remains intentionally unavailable until local-path security is configured.',
      inputSchema: targetSchema.extend({
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target_object, target_record_id, limit, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.attachments,
            filter: filterCondition(
              targetField(target_object),
              'eq',
              target_record_id,
            ),
            limit,
            depth: 1,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_list_messages',
    {
      title: 'List synced messages',
      description:
        'Lists synced email messages. This is read-only; direct email sending outside sequences is not exposed by Twenty here.',
      inputSchema: z.object({
        limit: listLimitSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: 'messages',
            limit,
            depth,
            orderBy: 'receivedAt[DescNullsLast]',
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_list_message_threads',
    {
      title: 'List synced message threads',
      description: 'Lists synced email message threads.',
      inputSchema: z.object({
        limit: listLimitSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.messageThreads,
            limit,
            depth,
          }),
        response_format,
      ),
  );
};

export const advancedReadToolsTesting = { targetField };
