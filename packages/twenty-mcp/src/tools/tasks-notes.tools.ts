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
import { buildRichTextValue, compactRecord } from './tool-data-builders.js';

const taskFieldsSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  type: z
    .enum([
      'CALL',
      'TODO',
      'LINKEDIN_CONNECTION',
      'LINKEDIN_MESSAGE',
      'EMAIL',
      'CUSTOM',
    ])
    .optional(),
  due_at: z.string().datetime().nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullable().optional(),
  assignee_id: z.string().nullable().optional(),
});

const noteFieldsSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
});

const targetSchema = z.object({
  target_object: z.enum(['company', 'person', 'opportunity']),
  target_record_id: recordIdSchema,
});

const targetRelationInput = (
  targetObject: 'company' | 'opportunity' | 'person',
  recordId: string,
): Record<string, unknown> => ({
  [`target${targetObject[0]?.toLocaleUpperCase()}${targetObject.slice(1)}Id`]:
    recordId,
});

const taskData = (
  value: z.infer<typeof taskFieldsSchema>,
): Record<string, unknown> =>
  compactRecord([
    ['title', value.title],
    [
      'bodyV2',
      value.body === undefined ? undefined : buildRichTextValue(value.body),
    ],
    ['status', value.status],
    ['type', value.type],
    ['dueAt', value.due_at],
    ['priority', value.priority],
    ['assigneeId', value.assignee_id],
  ]);

const noteData = (
  value: z.infer<typeof noteFieldsSchema>,
): Record<string, unknown> =>
  compactRecord([
    ['title', value.title],
    [
      'bodyV2',
      value.body === undefined ? undefined : buildRichTextValue(value.body),
    ],
  ]);

export const registerTaskAndNoteTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_create_task',
    {
      title: 'Create a task',
      description:
        'Creates a task. Use twenty_attach_task afterward to associate it with a CRM record.',
      inputSchema: taskFieldsSchema.extend({
        title: z.string().min(1),
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ depth, response_format, ...input }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.tasks,
            data: taskData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_task',
    {
      title: 'Update a task',
      description: 'Partially updates a task.',
      inputSchema: taskFieldsSchema.extend({
        id: recordIdSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, depth, response_format, ...input }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.tasks,
            id,
            data: taskData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_complete_task',
    {
      title: 'Complete a task',
      description: 'Marks a task DONE.',
      inputSchema: z.object({
        task_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ task_id, response_format }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.tasks,
            id: task_id,
            data: { status: 'DONE' },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_create_note',
    {
      title: 'Create a note',
      description:
        'Creates a note. Use twenty_attach_note afterward to associate it with a CRM record.',
      inputSchema: noteFieldsSchema.extend({
        title: z.string().min(1),
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ depth, response_format, ...input }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.notes,
            data: noteData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_note',
    {
      title: 'Update a note',
      description: 'Partially updates a note.',
      inputSchema: noteFieldsSchema.extend({
        id: recordIdSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, depth, response_format, ...input }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.notes,
            id,
            data: noteData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_attach_note',
    {
      title: 'Attach a note to a record',
      description:
        'Creates the noteTarget join that attaches a note to a person, company, or opportunity.',
      inputSchema: targetSchema.extend({
        note_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ note_id, target_object, target_record_id, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.noteTargets,
            data: {
              noteId: note_id,
              ...targetRelationInput(target_object, target_record_id),
            },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_attach_task',
    {
      title: 'Attach a task to a record',
      description:
        'Creates the taskTarget join that attaches a task to a person, company, or opportunity.',
      inputSchema: targetSchema.extend({
        task_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ task_id, target_object, target_record_id, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.taskTargets,
            data: {
              taskId: task_id,
              ...targetRelationInput(target_object, target_record_id),
            },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_list_activities',
    {
      title: 'List record activities',
      description:
        'Returns attached tasks, notes, and timeline activities for a person, company, or opportunity.',
      inputSchema: targetSchema.extend({
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target_object, target_record_id, limit, response_format }) =>
      runTool(async () => {
        const targetField = `target${target_object[0]?.toLocaleUpperCase()}${target_object.slice(1)}Id`;
        const filter = filterCondition(targetField, 'eq', target_record_id);
        const [tasks, notes, timeline] = await Promise.all([
          records.list({
            object: STANDARD_OBJECTS.taskTargets,
            filter,
            limit,
            depth: 1,
          }),
          records.list({
            object: STANDARD_OBJECTS.noteTargets,
            filter,
            limit,
            depth: 1,
          }),
          records.list({
            object: STANDARD_OBJECTS.timelineActivities,
            filter,
            limit,
            depth: 1,
          }),
        ]);

        return { tasks, notes, timeline };
      }, response_format),
  );
};

export const tasksNotesToolsTesting = {
  noteData,
  targetRelationInput,
  taskData,
};
