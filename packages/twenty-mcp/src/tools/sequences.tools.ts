import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  DEFAULT_SEQUENCE_SETTINGS,
  MAX_LIST_LIMIT,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_BRANCHES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_CONTINUE_MODES,
  SEQUENCE_TASK_PRIORITIES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_TEMPLATE_VARIABLES,
  SEQUENCE_WAITING_ON,
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
import { requireUserToken } from '../services/user-auth.js';
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
  dailyStartLimitEnabled: z.boolean(),
  dailyStarts: z.number().int().nonnegative(),
  staggerMinutes: z.number().nonnegative(),
  linkedinDailyActionLimitEnabled: z.boolean(),
  linkedinDailyActions: z.number().int().min(1).max(40),
  linkedinDelayPatternMinutes: z.array(z.number().positive()).min(1),
  stopOnReply: z.boolean(),
});

const CONNECTED_ACCOUNTS_QUERY = `
  query TwentyMcpConnectedAccounts {
    myConnectedAccounts {
      id
      handle
      provider
      name
      visibility
      scopes
      handleAliases
      connectionProviderId
      authFailedAt
      archivedAt
      lastSignedInAt
      lastCredentialsRefreshedAt
      createdAt
      updatedAt
    }
    myMessageChannels {
      handle
      connectedAccountId
      isSyncEnabled
      syncStatus
    }
  }
`;

type MessageChannel = {
  handle: string;
  connectedAccountId: string;
  isSyncEnabled: boolean;
  syncStatus: string;
};

type ConnectedAccount = {
  id?: unknown;
  handle?: unknown;
  provider?: unknown;
  authFailedAt?: unknown;
  archivedAt?: unknown;
  messageChannels?: MessageChannel[];
};

const SEQUENCE_SENDER_PROVIDERS = new Set([
  'google',
  'microsoft',
  'imap_smtp_caldav',
]);

const isReadySequenceSenderAccount = (account: ConnectedAccount): boolean =>
  account.archivedAt == null &&
  account.authFailedAt == null &&
  typeof account.handle === 'string' &&
  typeof account.provider === 'string' &&
  SEQUENCE_SENDER_PROVIDERS.has(account.provider) &&
  (account.messageChannels ?? []).some(
    (messageChannel) =>
      messageChannel.handle === account.handle &&
      messageChannel.isSyncEnabled &&
      messageChannel.syncStatus === 'ACTIVE',
  );

const filterConnectedAccounts = (
  accounts: ConnectedAccount[],
  {
    activeOnly,
    provider,
  }: {
    activeOnly: boolean;
    provider?: string;
  },
): ConnectedAccount[] =>
  accounts.filter(
    (account) =>
      (!activeOnly || isReadySequenceSenderAccount(account)) &&
      (provider === undefined || account.provider === provider),
  );

const sequenceStepBranchSchema = z
  .object({
    conditionStepId: recordIdSchema.describe(
      'ID of the CONDITION step that owns this branch.',
    ),
    outcome: z.enum(SEQUENCE_CONDITION_BRANCHES),
  })
  .describe(
    'Places the step in a condition Yes/No lane. Omit or pass null for the root flow.',
  );

const placementSettingsShape = {
  branch: sequenceStepBranchSchema.nullable().optional(),
};

const actionExecutionSettingsShape = {
  ...placementSettingsShape,
  executionMode: z
    .enum(SEQUENCE_ACTION_EXECUTION_MODES)
    .default('AUTOMATED')
    .describe(
      'AUTOMATED performs the action; MANUAL creates a task and waits for completion.',
    ),
  manualTaskTitle: z
    .string()
    .default('')
    .describe('Required when executionMode is MANUAL. Supports variables.'),
  manualTaskDescription: z
    .string()
    .default('')
    .describe('Task context used when executionMode is MANUAL.'),
};

const emailSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
  subject: z.string(),
  bodyHtml: z.string(),
  threadAsReplyToPreviousEmail: z.boolean().default(false),
  stopOnReply: z.boolean().nullable().default(null),
});

const delaySettingsSchema = z.object({
  ...placementSettingsShape,
  days: z.number().nonnegative().default(0),
  hours: z.number().nonnegative().default(0),
  minutes: z.number().nonnegative().default(0),
});

const taskSettingsSchema = z.object({
  ...placementSettingsShape,
  taskType: z.enum(SEQUENCE_TASK_TYPES).default('TODO'),
  titleTemplate: z.string().min(1),
  notesTemplate: z.string().default(''),
  priority: z.enum(SEQUENCE_TASK_PRIORITIES).default('MEDIUM'),
  assigneeWorkspaceMemberId: z.string().nullable().default(null),
  continueMode: z.enum(SEQUENCE_TASK_CONTINUE_MODES).default('ON_DONE'),
  deadlineDays: z.number().nonnegative().nullable().default(null),
});

const connectionRequestSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
  noteTemplate: z.string().default(''),
});

const linkedinMessageSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
  messageTemplate: z.string().min(1).max(2000),
});

const withdrawSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
  withdrawAfterDays: z.number().nonnegative().default(7),
  withdrawAfterHours: z.number().nonnegative().default(0),
});

const conditionSettingsSchema = z.object({
  ...placementSettingsShape,
  condition: z.enum(SEQUENCE_CONDITION_TYPES),
});

const enrichPhoneNumberSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
});

const stepInputSchema = z
  .discriminatedUnion('type', [
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
    z.object({
      type: z.literal(SEQUENCE_STEP_TYPES[6]),
      settings: conditionSettingsSchema,
    }),
    z.object({
      type: z.literal(SEQUENCE_STEP_TYPES[7]),
      settings: enrichPhoneNumberSettingsSchema,
    }),
  ])
  .superRefine((input, context) => {
    if (
      'executionMode' in input.settings &&
      input.settings.executionMode === 'MANUAL' &&
      input.settings.manualTaskTitle.trim().length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'manualTaskTitle is required for MANUAL execution.',
        path: ['settings', 'manualTaskTitle'],
      });
    }

    if (
      input.type === 'CONDITION' &&
      input.settings.branch !== undefined &&
      input.settings.branch !== null
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Nested conditions are not supported by the sequence builder. Add the condition to the root flow.',
        path: ['settings', 'branch'],
      });
    }

    if (
      input.type === 'CREATE_TASK' &&
      input.settings.continueMode === 'ON_DEADLINE' &&
      input.settings.deadlineDays === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'deadlineDays is required when continueMode is ON_DEADLINE.',
        path: ['settings', 'deadlineDays'],
      });
    }
  });

type SequenceStepInput = z.infer<typeof stepInputSchema>;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getSequenceStepStorageType = (
  type: SequenceStepInput['type'],
): SequenceStepInput['type'] => {
  switch (type) {
    case 'SEND_LINKEDIN_MESSAGE':
    case 'CONDITION':
    case 'ENRICH_PHONE_NUMBER':
      return 'CREATE_TASK';
    default:
      return type;
  }
};

const normalizedStepSettings = (
  input: SequenceStepInput,
): Record<string, unknown> => {
  const { branch, ...settings } = input.settings;

  return {
    type: input.type,
    ...settings,
    ...(branch === undefined || branch === null ? {} : { branch }),
  };
};

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
    ['type', getSequenceStepStorageType(input.type)],
    ['settings', normalizedStepSettings(input)],
    ['position', position],
  ]);

const getStepSettings = (step: unknown): UnknownRecord => {
  if (!isRecord(step) || !isRecord(step.settings)) {
    throw new Error('Twenty returned a sequence step without settings.');
  }

  return step.settings;
};

const getStepSequenceId = (step: unknown): string => {
  if (!isRecord(step) || typeof step.sequenceId !== 'string') {
    throw new Error('Twenty returned a sequence step without sequenceId.');
  }

  return step.sequenceId;
};

const withPreservedStepBranch = ({
  currentStep,
  input,
}: {
  currentStep: unknown;
  input: SequenceStepInput;
}): SequenceStepInput => {
  if (input.settings.branch !== undefined) {
    return input;
  }

  const currentBranch = getStepSettings(currentStep).branch;

  if (!isRecord(currentBranch)) {
    return input;
  }

  return {
    ...input,
    settings: {
      ...input.settings,
      branch: currentBranch as z.infer<typeof sequenceStepBranchSchema>,
    },
  } as SequenceStepInput;
};

const assertBranchTarget = async ({
  branch,
  records,
  sequenceId,
}: {
  branch: z.infer<typeof sequenceStepBranchSchema> | null | undefined;
  records: RecordsService;
  sequenceId: string;
}): Promise<void> => {
  if (branch === undefined || branch === null) {
    return;
  }

  const conditionStep = await records.get({
    object: STANDARD_OBJECTS.sequenceSteps,
    id: branch.conditionStepId,
  });

  if (
    getStepSequenceId(conditionStep) !== sequenceId ||
    getStepSettings(conditionStep).type !== 'CONDITION'
  ) {
    throw new Error(
      'branch.conditionStepId must reference a CONDITION step in the same sequence.',
    );
  }
};

const findDescendantStepIds = ({
  stepId,
  steps,
}: {
  stepId: string;
  steps: unknown[];
}): string[] => {
  const descendants: string[] = [];
  let parentIds = new Set([stepId]);

  while (parentIds.size > 0) {
    const childIds = steps
      .filter((step) => {
        if (!isRecord(step) || typeof step.id !== 'string') {
          return false;
        }

        const settings = isRecord(step.settings) ? step.settings : {};
        const branch = isRecord(settings.branch) ? settings.branch : {};

        return (
          typeof branch.conditionStepId === 'string' &&
          parentIds.has(branch.conditionStepId) &&
          !descendants.includes(step.id)
        );
      })
      .map((step) => (step as UnknownRecord).id as string);

    descendants.push(...childIds);
    parentIds = new Set(childIds);
  }

  return descendants;
};

const listAllSequenceSteps = async ({
  records,
  sequenceId,
}: {
  records: RecordsService;
  sequenceId: string;
}): Promise<unknown[]> => {
  const steps: unknown[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await records.list({
      object: STANDARD_OBJECTS.sequenceSteps,
      filter: filterCondition('sequenceId', 'eq', sequenceId),
      orderBy: 'position[AscNullsLast]',
      limit: MAX_LIST_LIMIT,
      startingAfter,
    });

    steps.push(...page.items);
    startingAfter =
      page.has_more && page.next_cursor !== null ? page.next_cursor : undefined;
  } while (startingAfter !== undefined);

  return steps;
};

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

const SEQUENCE_CAPABILITIES = {
  lifecycle: {
    statuses: SEQUENCE_STATUSES,
    activation_requirements: [
      'At least one step.',
      'A synchronized sender mailbox for every automated outbound email or LinkedIn step. The sender also determines which workspace member owns LinkedIn actions.',
      'Explicit confirmation because activation can start external outreach.',
    ],
    editing:
      'Pause the sequence before changing settings. Sender and step changes also require active enrollments to finish.',
  },
  sequence_settings: {
    defaults: DEFAULT_SEQUENCE_SETTINGS,
    active_days:
      'Integers 0-6 where 0 is Sunday. Empty means the sequence never opens.',
    sending_window:
      'windowStart/windowEnd are HH:mm in the configured IANA timezone.',
    daily_start_limit:
      'dailyStartLimitEnabled controls whether dailyStarts limits how many pending enrollments are admitted per local day.',
    daily_starts:
      'Maximum pending enrollments admitted into the active sequence per local day.',
    stagger_minutes:
      'Minimum spacing used when scheduling automated email starts.',
    linkedin_limits:
      'linkedinDailyActionLimitEnabled controls only the daily action cap, which accepts 1-40 actions per day. The sending window and workspace-wide delay pattern are always enforced.',
    stop_on_reply:
      'Sequence default. Automated email steps may inherit or override it.',
  },
  placement: {
    field: 'step.settings.branch',
    shape: {
      conditionStepId: 'ID of a CONDITION step in the same sequence',
      outcome: SEQUENCE_CONDITION_BRANCHES,
    },
    semantics:
      'A matching contact enters YES and a non-matching contact enters NO. Each lane runs by global position, then merges into the next root step. Nested conditions are not supported by the builder.',
  },
  execution_modes: {
    values: SEQUENCE_ACTION_EXECUTION_MODES,
    supported_steps: [
      'SEND_EMAIL',
      'SEND_CONNECTION_REQUEST',
      'SEND_LINKEDIN_MESSAGE',
      'WITHDRAW_CONNECTION_REQUEST',
      'ENRICH_PHONE_NUMBER',
    ],
    automated:
      'Performs or queues the action when the enrollment reaches the step.',
    manual:
      'Creates a linked task using manualTaskTitle/manualTaskDescription and waits until that task is completed.',
  },
  step_types: {
    SEND_EMAIL: {
      fields: [
        'subject',
        'bodyHtml',
        'threadAsReplyToPreviousEmail',
        'stopOnReply',
      ],
      automated: 'Sends through the selected connected account.',
      manual: 'Creates an EMAIL task and waits for completion.',
    },
    DELAY: {
      fields: ['days', 'hours', 'minutes'],
      behavior: 'Waits for the configured duration.',
    },
    CREATE_TASK: {
      fields: [
        'taskType',
        'titleTemplate',
        'notesTemplate',
        'priority',
        'assigneeWorkspaceMemberId',
        'continueMode',
        'deadlineDays',
      ],
      task_types: SEQUENCE_TASK_TYPES,
      priorities: SEQUENCE_TASK_PRIORITIES,
      continue_modes: {
        IMMEDIATE: 'Create the task and continue immediately.',
        ON_DONE: 'Wait until the linked task is completed.',
        ON_DEADLINE:
          'Continue when the task is completed or deadlineDays elapses.',
      },
    },
    SEND_CONNECTION_REQUEST: {
      fields: ['noteTemplate'],
      limits: 'The rendered note is truncated to 200 characters.',
      automated: 'Queues a LinkedIn connection action for the browser runner.',
      manual:
        'Creates a LINKEDIN_CONNECTION task with the profile URL and rendered note, unless the person is already connected or invited.',
    },
    SEND_LINKEDIN_MESSAGE: {
      fields: ['messageTemplate'],
      limits: 'Rendered message must contain 1-2000 characters.',
      automated:
        'Queues a LinkedIn message for a recognized first-degree connection.',
      manual:
        'Creates a LINKEDIN_MESSAGE task with the profile URL and rendered message for a recognized first-degree connection.',
    },
    WITHDRAW_CONNECTION_REQUEST: {
      fields: ['withdrawAfterDays', 'withdrawAfterHours'],
      automated: 'Queues a delayed LinkedIn invitation withdrawal.',
      manual:
        'Creates a CUSTOM task due after the configured withdrawal delay.',
    },
    CONDITION: {
      fields: ['condition'],
      conditions: {
        IS_IN_LINKEDIN_NETWORK:
          'True for a synced or recorded first-degree LinkedIn connection.',
        HAS_EMAIL_ADDRESS: 'True when the person has a primary email.',
        HAS_LINKEDIN_URL:
          'True when the person has a valid LinkedIn profile URL.',
        ACCEPTED_LINKEDIN_INVITE:
          'True for a synced or recorded first-degree LinkedIn connection.',
        OPENED_LINKEDIN_MESSAGE:
          'True for a confirmed recipient read receipt or an inbound reply after this enrollment sent its LinkedIn action.',
        HAS_PHONE_NUMBER: 'True when the person has a primary phone number.',
      },
    },
    ENRICH_PHONE_NUMBER: {
      fields: [],
      automated:
        'Uses Apollo enrichment when the person lacks a phone number; the enrollment fails if enrichment is disabled or no number is found.',
      manual: 'Creates a CUSTOM task to find and add a phone number.',
    },
  },
  enrollment: {
    statuses: SEQUENCE_ENROLLMENT_STATUSES,
    waiting_on: SEQUENCE_WAITING_ON,
    controls: [
      'Mark an open enrollment as replied.',
      'Skip an active enrollment to its next step now.',
      'Remove a pending or active enrollment while preserving history.',
    ],
  },
  template_variables: SEQUENCE_TEMPLATE_VARIABLES,
} as const;

export const registerSequenceTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_get_sequence_capabilities',
    {
      title: 'Get sequence builder capabilities',
      description:
        'Returns the current sequence lifecycle, settings, step schemas, conditions, Yes/No branch placement, automated/manual execution behavior, LinkedIn limits, phone enrichment behavior, task continuation, enrollment controls, and template variables. Call before creating or changing a sequence.',
      inputSchema: z.object({
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ response_format }) =>
      runTool(async () => SEQUENCE_CAPABILITIES, response_format),
  );

  server.registerTool(
    'twenty_list_connected_accounts',
    {
      title: 'List connected sender accounts',
      description:
        'Lists user-owned connected accounts that can be selected as sequence or one-off email senders. With active_only enabled, returns only supported mailboxes whose inbox sync is enabled and ACTIVE. Requires TWENTY_USER_TOKEN.',
      inputSchema: z.object({
        provider: z.string().min(1).optional(),
        active_only: z.boolean().default(true),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ provider, active_only, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          myConnectedAccounts: ConnectedAccount[];
          myMessageChannels: MessageChannel[];
        }>(
          CONNECTED_ACCOUNTS_QUERY,
          {},
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        const messageChannelsByConnectedAccountId = new Map<
          string,
          MessageChannel[]
        >();

        for (const messageChannel of result.myMessageChannels) {
          const channels =
            messageChannelsByConnectedAccountId.get(
              messageChannel.connectedAccountId,
            ) ?? [];

          channels.push(messageChannel);
          messageChannelsByConnectedAccountId.set(
            messageChannel.connectedAccountId,
            channels,
          );
        }

        const accountsWithMessageChannels = result.myConnectedAccounts.map(
          (account) => ({
            ...account,
            messageChannels:
              typeof account.id === 'string'
                ? (messageChannelsByConnectedAccountId.get(account.id) ?? [])
                : [],
          }),
        );

        return filterConnectedAccounts(accountsWithMessageChannels, {
          activeOnly: active_only,
          provider,
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_list_sequence_variables',
    {
      title: 'List sequence personalization variables',
      description:
        'Lists the template variables accepted in sequence email, task, and LinkedIn step content.',
      inputSchema: z.object({
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ response_format }) =>
      runTool(
        async () => ({
          syntax: 'Use the token exactly as shown in sequence step templates.',
          variables: SEQUENCE_TEMPLATE_VARIABLES,
        }),
        response_format,
      ),
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
        'Gets a sequence with settings, nested relations, enrollments, and metrics. Use twenty_list_sequence_steps when exact global/branch ordering is needed.',
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
    'twenty_list_sequence_steps',
    {
      title: 'List sequence steps',
      description:
        'Lists every step for one sequence in global position order, including each canonical settings.type, executionMode, and optional settings.branch placement.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ sequence_id, response_format }) =>
      runTool(async () => {
        const items = await listAllSequenceSteps({
          records,
          sequenceId: sequence_id,
        });

        return { count: items.length, items };
      }, response_format),
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
        'Activates, pauses, or returns a sequence to DRAFT. Activation requires at least one step and a synchronized sender mailbox whenever an automated email or LinkedIn outbound step exists.',
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
        'Adds any current sequence step: email, delay, task, LinkedIn action, condition, or phone enrichment. Put an action in a Yes/No lane with settings.branch={conditionStepId,outcome}. Action-capable steps accept AUTOMATED or MANUAL execution. The sequence must not be active.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        name: z.string().nullable().optional(),
        position: z.number().nonnegative().optional(),
        step: stepInputSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ sequence_id, name, position, step, response_format }) =>
      runTool(async () => {
        await assertBranchTarget({
          branch: step.settings.branch,
          records,
          sequenceId: sequence_id,
        });

        return records.create({
          object: STANDARD_OBJECTS.sequenceSteps,
          data: stepData({
            input: step,
            sequenceId: sequence_id,
            name,
            position,
          }),
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_update_sequence_step',
    {
      title: 'Update an outreach sequence step',
      description:
        'Updates the type/settings/name of a step. Omitted settings.branch preserves its current lane; null moves it to the root flow. The containing sequence must not be active.',
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
      runTool(async () => {
        const currentStep = await records.get({
          object: STANDARD_OBJECTS.sequenceSteps,
          id: step_id,
        });
        const input = stepInputSchema.parse(
          withPreservedStepBranch({ currentStep, input: step }),
        );

        await assertBranchTarget({
          branch: input.settings.branch,
          records,
          sequenceId: getStepSequenceId(currentStep),
        });

        return records.update({
          object: STANDARD_OBJECTS.sequenceSteps,
          id: step_id,
          data: stepData({ input, name }),
        });
      }, response_format),
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
        'Moves a sequence step to trash. Deleting a condition also trashes every descendant in its Yes/No lanes, matching the sequence builder. The sequence must not be active. Requires confirmation.',
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

        const step = await records.get({
          object: STANDARD_OBJECTS.sequenceSteps,
          id: step_id,
        });
        const steps = await listAllSequenceSteps({
          records,
          sequenceId: getStepSequenceId(step),
        });
        const descendantStepIds = findDescendantStepIds({
          stepId: step_id,
          steps,
        });
        const results = [];
        const descendantDeleteOrder = [...descendantStepIds].reverse();

        for (const descendantStepId of descendantDeleteOrder) {
          results.push({
            step_id: descendantStepId,
            result: await records.softDelete(
              STANDARD_OBJECTS.sequenceSteps,
              descendantStepId,
            ),
          });
        }

        results.push({
          step_id,
          result: await records.softDelete(
            STANDARD_OBJECTS.sequenceSteps,
            step_id,
          ),
        });

        return {
          deleted_step_id: step_id,
          deleted_descendant_ids: descendantStepIds,
          results,
        };
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
        'Lists enrollment execution state including waitingOn, nextActionAt, current step, sender, reply behavior, timestamps, and errors.',
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
    'twenty_mark_enrollment_replied',
    {
      title: 'Mark a sequence enrollment replied',
      description:
        'Marks a PENDING or ACTIVE enrollment as REPLIED, clears pending execution, and retains its history. Requires confirmation.',
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
            'Enrollment reply was not recorded: confirm the enrollment first.',
          );
        }

        return records.update({
          object: STANDARD_OBJECTS.sequenceEnrollments,
          id: enrollment_id,
          data: { status: 'REPLIED' },
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_skip_enrollment_to_next_step',
    {
      title: 'Skip enrollment to the next step',
      description:
        'Makes an ACTIVE enrollment immediately eligible to leave its current wait and process the next step. This can accelerate external outreach, so confirm the enrollment and next step first.',
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
        openWorldHint: true,
      },
    },
    async ({ enrollment_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Enrollment was not advanced: confirm the enrollment and next step first.',
          );
        }

        return records.update({
          object: STANDARD_OBJECTS.sequenceEnrollments,
          id: enrollment_id,
          data: {
            waitingOn: 'DELAY',
            nextActionAt: new Date().toISOString(),
          },
        });
      }, response_format),
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
  findDescendantStepIds,
  filterConnectedAccounts,
  getSequenceStepStorageType,
  isReadySequenceSenderAccount,
  normalizedStepSettings,
  stepData,
  stepInputSchema,
  withPreservedStepBranch,
};
