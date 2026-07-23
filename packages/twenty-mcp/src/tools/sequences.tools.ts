import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  DEFAULT_SEQUENCE_SETTINGS,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  STANDARD_OBJECTS,
} from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  depthSchema,
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { combineFilters, filterCondition } from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import type { ToolDependencies } from '../types.js';
import { compactRecord } from './tool-data-builders.js';

const sequenceSettingsSchema = z.object({
  activeDays: z.array(z.number().int().min(0).max(6)).max(7),
  windowStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  windowEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().refine((timezone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Must be an IANA timezone such as Europe/Helsinki or America/New_York'),
  dailyStarts: z.number().int().nonnegative(),
  staggerMinutes: z.number().nonnegative(),
  linkedinDailyActions: z.number().int().min(1).max(20),
  linkedinDelayPatternMinutes: z.array(z.number().positive()).min(1),
  stopOnReply: z.boolean(),
});

const emailSettingsSchema = z.object({
  subject: z.string(),
  bodyHtml: z.string(),
  threadAsReplyToPreviousEmail: z.boolean().default(false),
  stopOnReply: z.boolean().nullable().default(null),
});

const delaySettingsSchema = z.object({
  days: z.number().int().nonnegative().default(0),
  hours: z.number().int().nonnegative().default(0),
  minutes: z.number().int().nonnegative().default(0),
});

const taskSettingsSchema = z.object({
  taskType: z
    .enum([
      'CALL',
      'TODO',
      'LINKEDIN_CONNECTION',
      'LINKEDIN_MESSAGE',
      'EMAIL',
      'CUSTOM',
    ])
    .default('TODO'),
  titleTemplate: z.string(),
  notesTemplate: z.string().default(''),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeWorkspaceMemberId: z.string().nullable().default(null),
  continueMode: z
    .enum(['IMMEDIATE', 'ON_DONE', 'ON_DEADLINE'])
    .default('ON_DONE'),
  deadlineDays: z.number().int().nonnegative().nullable().default(null),
});

const connectionRequestSettingsSchema = z.object({
  noteTemplate: z.string().default(''),
  skipIfAlreadyConnected: z.boolean().default(true),
});

const linkedinMessageSettingsSchema = z.object({
  messageTemplate: z.string().min(1),
});

const withdrawSettingsSchema = z.object({
  withdrawAfterDays: z.number().int().nonnegative().default(0),
  withdrawAfterHours: z.number().int().nonnegative().default(0),
});

const stepInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[0]),
    settings: emailSettingsSchema,
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[1]),
    settings: delaySettingsSchema,
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[2]),
    settings: taskSettingsSchema,
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[3]),
    settings: connectionRequestSettingsSchema,
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[4]),
    settings: linkedinMessageSettingsSchema,
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[5]),
    settings: withdrawSettingsSchema,
  }),
]);

type SequenceStepInput = z.infer<typeof stepInputSchema>;

const stepData = ({
  input,
  name,
  position,
  sequenceId,
}: {
  input: SequenceStepInput;
  name?: string | null;
  position?: number;
  sequenceId?: string;
}): Record<string, unknown> =>
  compactRecord([
    ['sequenceId', sequenceId],
    ['name', name],
    ['type', input.type],
    ['settings', { type: input.type, ...input.settings }],
    ['position', position],
  ]);

const createSequenceData = ({
  name,
  settings,
  senderConnectedAccountId,
}: {
  name: string;
  settings?: Partial<z.infer<typeof sequenceSettingsSchema>>;
  senderConnectedAccountId?: string;
}): Record<string, unknown> => ({
  name,
  settings: { ...DEFAULT_SEQUENCE_SETTINGS, ...settings },
  ...(senderConnectedAccountId === undefined
    ? {}
    : { senderConnectedAccountId }),
});

export const registerSequenceTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_list_sequences',
    {
      title: 'List outreach sequences',
      description:
        'Lists sequences with status and denormalized enrollment/reply/failure metrics.',
      inputSchema: z.object({
        status: z.enum(SEQUENCE_STATUSES).optional(),
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ status, limit, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.sequences,
            filter:
              status === undefined
                ? undefined
                : filterCondition('status', 'eq', status),
            orderBy: 'position[AscNullsFirst]',
            limit,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_sequence',
    {
      title: 'Get an outreach sequence',
      description:
        'Gets a sequence with ordered steps, settings, enrollments, and metrics.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        depth: depthSchema.default(2),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ sequence_id, depth, response_format }) =>
      runTool(
        () =>
          records.get({
            object: STANDARD_OBJECTS.sequences,
            id: sequence_id,
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_create_sequence',
    {
      title: 'Create an outreach sequence',
      description:
        'Creates a DRAFT sequence with safe weekday/business-hour defaults unless settings are supplied.',
      inputSchema: z.object({
        name: z.string().min(1),
        settings: sequenceSettingsSchema.partial().optional(),
        sender_connected_account_id: z.string().optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ name, settings, sender_connected_account_id, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.sequences,
            data: createSequenceData({
              name,
              settings,
              senderConnectedAccountId: sender_connected_account_id,
            }),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_sequence',
    {
      title: 'Update an outreach sequence',
      description:
        'Renames a sequence or changes settings/sender. Twenty requires pausing before settings changes when active.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        name: z.string().min(1).optional(),
        settings: sequenceSettingsSchema.optional(),
        sender_connected_account_id: z.string().nullable().optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({
      sequence_id,
      name,
      settings,
      sender_connected_account_id,
      response_format,
    }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.sequences,
            id: sequence_id,
            data: compactRecord([
              ['name', name],
              ['settings', settings],
              ['senderConnectedAccountId', sender_connected_account_id],
            ]),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_set_sequence_status',
    {
      title: 'Set outreach sequence status',
      description:
        'Activates, pauses, or returns a sequence to DRAFT. Activation requires a sender and at least one step.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        status: z.enum(SEQUENCE_STATUSES),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Must be true when status is ACTIVE because activation can begin outreach.',
          ),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sequence_id, status, confirm, response_format }) =>
      runTool(async () => {
        if (status === 'ACTIVE' && !confirm) {
          throw new Error(
            'Sequence activation not performed: confirm the sequence, sender, recipients, and content first.',
          );
        }

        return records.update({
          object: STANDARD_OBJECTS.sequences,
          id: sequence_id,
          data: { status },
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_add_sequence_step',
    {
      title: 'Add an outreach sequence step',
      description:
        'Adds a typed email, delay, task, LinkedIn, or withdrawal step. The sequence must not be active.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        name: z.string().nullable().optional(),
        position: z.number().optional(),
        step: stepInputSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ sequence_id, name, position, step, response_format }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.sequenceSteps,
            data: stepData({
              input: step,
              sequenceId: sequence_id,
              name,
              position,
            }),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_sequence_step',
    {
      title: 'Update an outreach sequence step',
      description:
        'Updates the type/settings/name of a step. The containing sequence must not be active.',
      inputSchema: z.object({
        step_id: recordIdSchema,
        name: z.string().nullable().optional(),
        step: stepInputSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ step_id, name, step, response_format }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.sequenceSteps,
            id: step_id,
            data: stepData({ input: step, name }),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_reorder_sequence_step',
    {
      title: 'Reorder an outreach sequence step',
      description:
        'Changes the position of one sequence step. The sequence must not be active.',
      inputSchema: z.object({
        step_id: recordIdSchema,
        position: z.number(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ step_id, position, response_format }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.sequenceSteps,
            id: step_id,
            data: { position },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_delete_sequence_step',
    {
      title: 'Delete an outreach sequence step',
      description:
        'Moves a sequence step to trash. The sequence must not be active. Requires confirmation.',
      inputSchema: z.object({
        step_id: recordIdSchema,
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
    async ({ step_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Step deletion not performed: confirm must be true after explicit user confirmation.',
          );
        }

        return records.softDelete(STANDARD_OBJECTS.sequenceSteps, step_id);
      }, response_format),
  );

  server.registerTool(
    'twenty_enroll_person_in_sequence',
    {
      title: 'Enroll a person in a sequence',
      description:
        'Creates a PENDING enrollment. Execution is asynchronous and begins only under Twenty sequence invariants. Confirm recipient and sequence first.',
      inputSchema: z.object({
        person_id: recordIdSchema,
        sequence_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ person_id, sequence_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Enrollment not performed: confirm the person and sequence first.',
          );
        }

        return records.create({
          object: STANDARD_OBJECTS.sequenceEnrollments,
          data: { personId: person_id, sequenceId: sequence_id },
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_bulk_enroll_people',
    {
      title: 'Bulk-enroll people in a sequence',
      description:
        'Enrolls up to 100 people and reports success/failure per person. Confirm the complete recipient set first.',
      inputSchema: z.object({
        person_ids: z.array(recordIdSchema).min(1).max(100),
        sequence_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ person_ids, sequence_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Bulk enrollment not performed: confirm the full recipient set and sequence first.',
          );
        }

        const results = await Promise.allSettled(
          person_ids.map((personId) =>
            records.create({
              object: STANDARD_OBJECTS.sequenceEnrollments,
              data: { personId, sequenceId: sequence_id },
            }),
          ),
        );

        return {
          sequence_id,
          succeeded: results.filter((result) => result.status === 'fulfilled')
            .length,
          failed: results.filter((result) => result.status === 'rejected')
            .length,
          results: results.map((result, index) => ({
            person_id: person_ids[index],
            status: result.status,
            ...(result.status === 'fulfilled'
              ? { result: result.value }
              : {
                  error:
                    result.reason instanceof Error
                      ? result.reason.message
                      : String(result.reason),
                }),
          })),
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_list_enrollments',
    {
      title: 'List sequence enrollments',
      description:
        'Lists enrollment execution state including waitingOn, nextActionAt, current step, and errors.',
      inputSchema: z.object({
        sequence_id: z.string().optional(),
        person_id: z.string().optional(),
        status: z.enum(SEQUENCE_ENROLLMENT_STATUSES).optional(),
        limit: listLimitSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ sequence_id, person_id, status, limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.sequenceEnrollments,
            filter: combineFilters('and', [
              sequence_id === undefined
                ? undefined
                : filterCondition('sequenceId', 'eq', sequence_id),
              person_id === undefined
                ? undefined
                : filterCondition('personId', 'eq', person_id),
              status === undefined
                ? undefined
                : filterCondition('status', 'eq', status),
            ]),
            limit,
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_stop_enrollment',
    {
      title: 'Stop a sequence enrollment',
      description:
        'Transitions a PENDING or ACTIVE enrollment to the supported terminal REMOVED state. Enrollment history is retained.',
      inputSchema: z.object({
        enrollment_id: recordIdSchema,
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
    async ({ enrollment_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Enrollment stop not performed: confirm must be true after explicit user confirmation.',
          );
        }

        return records.update({
          object: STANDARD_OBJECTS.sequenceEnrollments,
          id: enrollment_id,
          data: { status: 'REMOVED' },
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_get_sequence_metrics',
    {
      title: 'Get sequence metrics',
      description:
        'Returns sequence counters plus enrollment counts grouped by status.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ sequence_id, response_format }) =>
      runTool(async () => {
        const [sequence, enrollmentGroups] = await Promise.all([
          records.get({
            object: STANDARD_OBJECTS.sequences,
            id: sequence_id,
          }),
          records.groupBy({
            object: STANDARD_OBJECTS.sequenceEnrollments,
            groupBy: [{ status: true }],
            aggregate: ['countId'],
            filter: filterCondition('sequenceId', 'eq', sequence_id),
          }),
        ]);

        return { sequence, enrollments_by_status: enrollmentGroups };
      }, response_format),
  );
};

export const sequencesToolsTesting = {
  createSequenceData,
  stepData,
};
