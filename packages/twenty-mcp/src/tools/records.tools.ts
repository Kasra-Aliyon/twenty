import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  depthSchema,
  fieldsSchema,
  listLimitSchema,
  objectSlugSchema,
  orderBySchema,
  rawFilterSchema,
  recordDataSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { RecordsService } from '../services/records.service.js';
import type { ToolDependencies } from '../types.js';

const SEQUENCE_ENGINE_OBJECT_NAMES = new Set(
  [
    STANDARD_OBJECTS.sequences,
    STANDARD_OBJECTS.sequenceSteps,
    STANDARD_OBJECTS.sequenceEnrollments,
    'sequence',
    'sequenceStep',
    'sequenceEnrollment',
  ].map((objectName) => objectName.toLowerCase()),
);

const assertGenericRecordMutationAllowed = (object: string): void => {
  if (!SEQUENCE_ENGINE_OBJECT_NAMES.has(object.toLowerCase())) {
    return;
  }

  throw new Error(
    'Generic record mutations are disabled for sequences, sequence steps, and sequence enrollments. Use the dedicated sequence tools so lifecycle validation and confirmation cannot be bypassed.',
  );
};

export const registerRecordTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_list_records',
    {
      title: 'List Twenty records',
      description:
        'Lists records for any standard or custom object with filters, ordering, relation depth, cursor pagination, and response projection.',
      inputSchema: z.object({
        object: objectSlugSchema,
        filter: rawFilterSchema,
        order_by: orderBySchema,
        limit: listLimitSchema,
        depth: depthSchema,
        starting_after: z.string().optional(),
        ending_before: z.string().optional(),
        fields: fieldsSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      object,
      filter,
      order_by,
      limit,
      depth,
      starting_after,
      ending_before,
      fields,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object,
            filter,
            orderBy: order_by,
            limit,
            depth,
            startingAfter: starting_after,
            endingBefore: ending_before,
            fields,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_record',
    {
      title: 'Get a Twenty record',
      description:
        'Fetches one record from any standard or custom object by ID.',
      inputSchema: z.object({
        object: objectSlugSchema,
        id: recordIdSchema,
        depth: depthSchema,
        fields: fieldsSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ object, id, depth, fields, response_format }) =>
      runTool(
        () => records.get({ object, id, depth, fields }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_create_record',
    {
      title: 'Create a Twenty record',
      description:
        'Creates one record for any live object except sequence engine objects, which require dedicated sequence tools. Field names, values, and enums are validated against cached live metadata first.',
      inputSchema: z.object({
        object: objectSlugSchema,
        data: recordDataSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ object, data, depth, response_format }) =>
      runTool(async () => {
        assertGenericRecordMutationAllowed(object);

        return records.create({ object, data, depth });
      }, response_format),
  );

  server.registerTool(
    'twenty_update_record',
    {
      title: 'Update a Twenty record',
      description:
        'Partially updates one record except sequence engine objects, which require dedicated sequence tools, after validating field names, types, and enum values against live metadata.',
      inputSchema: z.object({
        object: objectSlugSchema,
        id: recordIdSchema,
        data: recordDataSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ object, id, data, depth, response_format }) =>
      runTool(async () => {
        assertGenericRecordMutationAllowed(object);

        return records.update({ object, id, data, depth });
      }, response_format),
  );

  server.registerTool(
    'twenty_delete_record',
    {
      title: 'Move a Twenty record to trash',
      description:
        'Soft-deletes one non-sequence-engine record by sending soft_delete=true. The operation is recoverable with twenty_restore_record.',
      inputSchema: z.object({
        object: objectSlugSchema,
        id: recordIdSchema,
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
    async ({ object, id, confirm, response_format }) =>
      runTool(async () => {
        assertGenericRecordMutationAllowed(object);

        if (!confirm) {
          throw new Error(
            'Soft delete not performed: confirm must be true after explicit user confirmation.',
          );
        }

        return records.softDelete(object, id);
      }, response_format),
  );

  server.registerTool(
    'twenty_restore_record',
    {
      title: 'Restore a Twenty record',
      description:
        'Restores one soft-deleted non-sequence-engine record from trash.',
      inputSchema: z.object({
        object: objectSlugSchema,
        id: recordIdSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ object, id, depth, response_format }) =>
      runTool(async () => {
        assertGenericRecordMutationAllowed(object);

        return records.restore(object, id, depth);
      }, response_format),
  );

  server.registerTool(
    'twenty_batch_create_records',
    {
      title: 'Batch-create Twenty records',
      description:
        'Creates up to 100 records of one standard or custom object except sequence engine objects, which require dedicated sequence tools. This is a bulk mutation; confirm the intended set before calling.',
      inputSchema: z.object({
        object: objectSlugSchema,
        data: z.array(recordDataSchema).min(1).max(100),
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ object, data, confirm, depth, response_format }) =>
      runTool(async () => {
        assertGenericRecordMutationAllowed(object);

        if (!confirm) {
          throw new Error(
            'Batch create not performed: confirm must be true after explicit user confirmation.',
          );
        }

        return records.batchCreate({ object, data, depth });
      }, response_format),
  );

  server.registerTool(
    'twenty_find_duplicates',
    {
      title: 'Find duplicate Twenty records',
      description:
        'Finds duplicate groups for supplied candidate data and/or existing record IDs.',
      inputSchema: z
        .object({
          object: objectSlugSchema,
          data: z.array(recordDataSchema).min(1).max(100).optional(),
          ids: z.array(recordIdSchema).min(1).max(100).optional(),
          depth: depthSchema,
          response_format: responseFormatSchema,
        })
        .refine(
          (value) => value.data !== undefined || value.ids !== undefined,
          {
            message: 'Provide data and/or ids.',
          },
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ object, data, ids, depth, response_format }) =>
      runTool(
        () => records.findDuplicates({ object, data, ids, depth }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_merge_records',
    {
      title: 'Merge duplicate Twenty records',
      description:
        'Merges two or more existing non-sequence-engine records. conflict_priority_index selects the winning record in ids. Use dry_run first and require explicit confirmation for the real merge.',
      inputSchema: z.object({
        object: objectSlugSchema,
        ids: z.array(recordIdSchema).min(2).max(20),
        conflict_priority_index: z.number().int().min(0),
        dry_run: z.boolean().default(true),
        confirm: z.boolean().default(false).describe(CONFIRMATION_DESCRIPTION),
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({
      object,
      ids,
      conflict_priority_index,
      dry_run,
      confirm,
      depth,
      response_format,
    }) =>
      runTool(async () => {
        assertGenericRecordMutationAllowed(object);

        if (!dry_run && !confirm) {
          throw new Error(
            'Merge not performed: confirm must be true for a non-dry-run merge.',
          );
        }

        if (conflict_priority_index >= ids.length) {
          throw new Error(
            'conflict_priority_index must point to an item in ids.',
          );
        }

        return records.merge({
          object,
          ids,
          conflictPriorityIndex: conflict_priority_index,
          dryRun: dry_run,
          depth,
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_group_by',
    {
      title: 'Group and aggregate Twenty records',
      description:
        'Returns board/pipeline-style groups and requested aggregate fields for any object.',
      inputSchema: z.object({
        object: objectSlugSchema,
        group_by: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe('For example [{"stage": true}].'),
        aggregate: z
          .array(z.string())
          .optional()
          .describe(
            'Available aggregation keys, for example countNotEmptyId or sumAmountAmountMicros. Twenty validates exact keys.',
          ),
        filter: rawFilterSchema,
        order_by: orderBySchema,
        limit: listLimitSchema,
        include_records: z.boolean().default(false),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      object,
      group_by,
      aggregate,
      filter,
      order_by,
      limit,
      include_records,
      response_format,
    }) =>
      runTool(
        () =>
          records.groupBy({
            object,
            groupBy: group_by,
            aggregate,
            filter,
            orderBy: order_by,
            limit,
            includeRecords: include_records,
          }),
        response_format,
      ),
  );

  if (dependencies.enableAdvanced) {
    server.registerTool(
      'twenty_destroy_record',
      {
        title: 'Permanently destroy a Twenty record',
        description:
          'Permanently and irreversibly destroys one non-sequence-engine record. Prefer twenty_delete_record. Requires explicit confirmation.',
        inputSchema: z.object({
          object: objectSlugSchema,
          id: recordIdSchema,
          confirm: z.literal(true).describe(CONFIRMATION_DESCRIPTION),
          response_format: responseFormatSchema,
        }),
        outputSchema: TOOL_OUTPUT_SCHEMA,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async ({ object, id, response_format }) =>
        runTool(async () => {
          assertGenericRecordMutationAllowed(object);

          return records.destroy(object, id);
        }, response_format),
    );
  }
};
