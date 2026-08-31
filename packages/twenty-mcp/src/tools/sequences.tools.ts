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
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_TASK_CONTINUE_MODES,
  SEQUENCE_TASK_PRIORITIES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_TEMPLATE_VARIABLES,
  SEQUENCE_WAITING_ON,
  SERVER_VERSION,
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
import { TwentyApiError } from '../services/errors.js';
import { combineFilters, filterCondition } from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import type { TwentyClient } from '../services/twenty-client.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';
import { compactRecord } from './tool-data-builders.js';

const sequenceSettingsSchema = z.object({
  activeDays: z.array(z.number().int().min(0).max(6)).max(7),
  windowStart: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .describe('Start of the LinkedIn, call, and non-email task window.'),
  windowEnd: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .describe('End of the LinkedIn, call, and non-email task window.'),
  emailWindowStart: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .describe('Start of the automated and manual email step window.')
    .optional(),
  emailWindowEnd: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .describe('End of the automated and manual email step window.')
    .optional(),
  timezone: z
    .string()
    .refine((timezone) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        return true;
      } catch {
        return false;
      }
    }, 'Must be an IANA timezone such as Europe/Helsinki or America/New_York')
    .describe(
      'IANA sequence timezone used for LinkedIn steps, calls, and other non-email work. Email steps, including automated delivery and manual email task surfacing, also use it when sendWindowTimezoneMode is SEQUENCE.',
    ),
  sendWindowTimezoneMode: z
    .enum([
      SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
      SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
    ])
    .default(SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE)
    .describe(
      'Controls scheduling for every email step. SEQUENCE uses settings.timezone. RECIPIENT uses the Person timeZone field with a UTC fallback for automated email delivery and manual email task surfacing. LinkedIn steps, calls, and other non-email work always use settings.timezone.',
    ),
  dailyStartLimitEnabled: z.boolean(),
  dailyStarts: z.number().int().min(1),
  staggerMinutes: z.number().nonnegative(),
  linkedinDailyActionLimitEnabled: z.boolean(),
  linkedinDailyActions: z.number().int().min(1).max(40),
  linkedinDelayPatternMinutes: z.array(z.number().positive()).min(1),
  stopOnReply: z.boolean(),
  senderConnectedAccountIds: z
    .array(recordIdSchema)
    .max(20)
    .refine(
      (connectedAccountIds) =>
        new Set(connectedAccountIds).size === connectedAccountIds.length,
      'Sender pool cannot contain duplicate connected accounts.',
    )
    .optional(),
});

const sequenceSettingsPatchSchema = z.object({
  activeDays: sequenceSettingsSchema.shape.activeDays.optional(),
  windowStart: sequenceSettingsSchema.shape.windowStart.optional(),
  windowEnd: sequenceSettingsSchema.shape.windowEnd.optional(),
  emailWindowStart: sequenceSettingsSchema.shape.emailWindowStart.optional(),
  emailWindowEnd: sequenceSettingsSchema.shape.emailWindowEnd.optional(),
  timezone: sequenceSettingsSchema.shape.timezone.optional(),
  sendWindowTimezoneMode: sequenceSettingsSchema.shape.sendWindowTimezoneMode
    .removeDefault()
    .optional(),
  dailyStartLimitEnabled:
    sequenceSettingsSchema.shape.dailyStartLimitEnabled.optional(),
  dailyStarts: sequenceSettingsSchema.shape.dailyStarts.optional(),
  staggerMinutes: sequenceSettingsSchema.shape.staggerMinutes.optional(),
  linkedinDailyActionLimitEnabled:
    sequenceSettingsSchema.shape.linkedinDailyActionLimitEnabled.optional(),
  linkedinDailyActions:
    sequenceSettingsSchema.shape.linkedinDailyActions.optional(),
  linkedinDelayPatternMinutes:
    sequenceSettingsSchema.shape.linkedinDelayPatternMinutes.optional(),
  stopOnReply: sequenceSettingsSchema.shape.stopOnReply.optional(),
  senderConnectedAccountIds:
    sequenceSettingsSchema.shape.senderConnectedAccountIds,
});

const SEQUENCE_MCP_CONTRACT_VERSION = '2026-08-27.2';
const SEQUENCE_SETTINGS_ATOMIC_PATCH_MARKER =
  '__twentySequenceSettingsAtomicPatch';
const SEQUENCE_STEP_SETTINGS_PATCH_BASE_TYPE =
  '__twentySequenceStepSettingsPatchBaseType';
const SEQUENCE_STEP_ATOMIC_APPEND_MARKER = '__twentySequenceStepAtomicAppend';

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
      sequenceDailyEmailLimitEnabled
      sequenceDailyEmailLimit
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
  sequenceDailyEmailLimitEnabled?: unknown;
  sequenceDailyEmailLimit?: unknown;
  messageChannels?: MessageChannel[];
};

const UPDATE_SEQUENCE_MAILBOX_LIMIT_MUTATION = `
  mutation TwentyMcpUpdateSequenceMailboxLimit(
    $id: UUID!
    $input: ConnectedAccountSequenceEmailSettingsInput!
  ) {
    updateConnectedAccountSequenceEmailSettings(id: $id, input: $input) {
      id
      handle
      sequenceDailyEmailLimitEnabled
      sequenceDailyEmailLimit
    }
  }
`;

const SEQUENCE_ANALYTICS_QUERY = `
  query TwentyMcpSequenceAnalytics($sequenceId: UUID!) {
    sequenceAnalytics(sequenceId: $sequenceId) {
      enrolledCount
      contactedCount
      sentEmailCount
      repliedCount
      completedCount
      failedCount
      replyRate
      emailVariants {
        stepId
        stepName
        variantId
        variantName
        sentCount
        repliedCount
        replyRate
      }
    }
  }
`;

const SEQUENCE_READINESS_QUERY = `
  query TwentyMcpSequenceReadiness($sequenceId: UUID!) {
    sequenceReadiness(sequenceId: $sequenceId) {
      ready
      errors
    }
  }
`;

const SEQUENCE_MUTATION_CAPABILITIES_QUERY = `
  query TwentyMcpSequenceMutationCapabilities {
    sequenceMutationCapabilities {
      atomicSettingsPatch
      atomicSettingsPatchVersion
      atomicStepAppend
      atomicStepAppendVersion
    }
  }
`;

const SEQUENCE_ENROLLMENT_START_STEP_CAPABILITIES_QUERY = `
  query TwentyMcpSequenceEnrollmentStartStepCapabilities {
    sequenceMutationCapabilities {
      enrollmentStartStep
      enrollmentStartStepVersion
    }
  }
`;

const SEQUENCE_SENDER_PROVIDERS = new Set([
  'google',
  'microsoft',
  'imap_smtp_caldav',
]);

const isSequenceSenderAccount = (account: ConnectedAccount): boolean =>
  account.archivedAt == null &&
  typeof account.handle === 'string' &&
  typeof account.provider === 'string' &&
  SEQUENCE_SENDER_PROVIDERS.has(account.provider);

const isReadySequenceEmailSenderAccount = (
  account: ConnectedAccount,
): boolean =>
  isSequenceSenderAccount(account) &&
  account.authFailedAt == null &&
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
    useCase,
  }: {
    activeOnly: boolean;
    provider?: string;
    useCase: 'SEQUENCE' | 'EMAIL';
  },
): ConnectedAccount[] =>
  accounts.filter(
    (account) =>
      (!activeOnly ||
        (useCase === 'SEQUENCE'
          ? isSequenceSenderAccount(account)
          : isReadySequenceEmailSenderAccount(account))) &&
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

const emailVariantSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(60),
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  weight: z.number().positive(),
});

const emailSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
  subject: z.string(),
  bodyHtml: z.string(),
  variants: z
    .array(emailVariantSchema)
    .min(2)
    .max(2)
    .refine(
      (variants) =>
        new Set(variants.map(({ id }) => id)).size === variants.length,
      'Email variant IDs must be unique.',
    )
    .optional(),
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
  assigneeWorkspaceMemberId: recordIdSchema.nullable().default(null),
  continueMode: z.enum(SEQUENCE_TASK_CONTINUE_MODES).default('ON_DONE'),
  deadlineDays: z.number().nonnegative().nullable().default(null),
});

const connectionRequestSettingsSchema = z.object({
  ...actionExecutionSettingsShape,
  noteTemplate: z.string().max(200).default(''),
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
  expected: z.boolean().optional(),
});

const sequenceStepPositionSchema = z.number().nonnegative();

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
      input.type === 'SEND_EMAIL' &&
      input.settings.executionMode === 'MANUAL' &&
      input.settings.variants !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Email variants are supported only for AUTOMATED execution.',
        path: ['settings', 'variants'],
      });
    }

    if (
      input.type === 'SEND_EMAIL' &&
      input.settings.executionMode === 'MANUAL' &&
      (input.settings.threadAsReplyToPreviousEmail ||
        input.settings.stopOnReply === true)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Manual email tasks do not support reply threading or automatic stop-on-reply.',
        path: ['settings', 'stopOnReply'],
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

const actionExecutionSettingsPatchShape = {
  ...placementSettingsShape,
  executionMode: actionExecutionSettingsShape.executionMode
    .removeDefault()
    .optional(),
  manualTaskTitle: actionExecutionSettingsShape.manualTaskTitle
    .removeDefault()
    .optional(),
  manualTaskDescription: actionExecutionSettingsShape.manualTaskDescription
    .removeDefault()
    .optional(),
};

const stepUpdateInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[0]),
    settings: z.object({
      ...actionExecutionSettingsPatchShape,
      subject: emailSettingsSchema.shape.subject.optional(),
      bodyHtml: emailSettingsSchema.shape.bodyHtml.optional(),
      variants: emailSettingsSchema.shape.variants.nullable(),
      threadAsReplyToPreviousEmail:
        emailSettingsSchema.shape.threadAsReplyToPreviousEmail
          .removeDefault()
          .optional(),
      stopOnReply: emailSettingsSchema.shape.stopOnReply
        .removeDefault()
        .optional(),
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[1]),
    settings: z.object({
      ...placementSettingsShape,
      days: delaySettingsSchema.shape.days.removeDefault().optional(),
      hours: delaySettingsSchema.shape.hours.removeDefault().optional(),
      minutes: delaySettingsSchema.shape.minutes.removeDefault().optional(),
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[2]),
    settings: z.object({
      ...placementSettingsShape,
      taskType: taskSettingsSchema.shape.taskType.removeDefault().optional(),
      titleTemplate: taskSettingsSchema.shape.titleTemplate.optional(),
      notesTemplate: taskSettingsSchema.shape.notesTemplate
        .removeDefault()
        .optional(),
      priority: taskSettingsSchema.shape.priority.removeDefault().optional(),
      assigneeWorkspaceMemberId:
        taskSettingsSchema.shape.assigneeWorkspaceMemberId
          .removeDefault()
          .optional(),
      continueMode: taskSettingsSchema.shape.continueMode
        .removeDefault()
        .optional(),
      deadlineDays: taskSettingsSchema.shape.deadlineDays
        .removeDefault()
        .optional(),
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[3]),
    settings: z.object({
      ...actionExecutionSettingsPatchShape,
      noteTemplate: connectionRequestSettingsSchema.shape.noteTemplate
        .removeDefault()
        .optional(),
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[4]),
    settings: z.object({
      ...actionExecutionSettingsPatchShape,
      messageTemplate:
        linkedinMessageSettingsSchema.shape.messageTemplate.optional(),
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[5]),
    settings: z.object({
      ...actionExecutionSettingsPatchShape,
      withdrawAfterDays: withdrawSettingsSchema.shape.withdrawAfterDays
        .removeDefault()
        .optional(),
      withdrawAfterHours: withdrawSettingsSchema.shape.withdrawAfterHours
        .removeDefault()
        .optional(),
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[6]),
    settings: z.object({
      ...placementSettingsShape,
      condition: conditionSettingsSchema.shape.condition.optional(),
      expected: conditionSettingsSchema.shape.expected,
    }),
  }),
  z.object({
    type: z.literal(SEQUENCE_STEP_TYPES[7]),
    settings: z.object(actionExecutionSettingsPatchShape),
  }),
]);

type SequenceStepInput = z.infer<typeof stepInputSchema>;
type SequenceStepUpdateInput = z.infer<typeof stepUpdateInputSchema>;

type UnknownRecord = Record<string, unknown>;

type SequenceEmailVariantAnalytics = {
  stepId: string;
  stepName: string;
  variantId: string;
  variantName: string;
  sentCount: number;
  repliedCount: number;
  replyRate: number;
};

type SequenceAnalytics = {
  enrolledCount: number;
  contactedCount: number;
  sentEmailCount: number;
  repliedCount: number;
  completedCount: number;
  failedCount: number;
  replyRate: number;
  emailVariants: SequenceEmailVariantAnalytics[];
};

type SequenceAnalyticsStep = {
  id: string;
  name: string | null;
  position: number;
  settings: UnknownRecord;
};

type SequenceValidationStep = SequenceAnalyticsStep & {
  createdAt: string;
};

type SequenceValidationBranch = {
  conditionStepId: string;
  outcome: string;
};

const DEFAULT_SEQUENCE_EMAIL_VARIANT_ID = 'default';
const DEFAULT_SEQUENCE_EMAIL_VARIANT_NAME = 'Default';

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
  const normalizedSettings =
    input.type === 'SEND_EMAIL' &&
    'executionMode' in settings &&
    settings.executionMode === 'MANUAL'
      ? {
          ...settings,
          threadAsReplyToPreviousEmail: false,
          stopOnReply: false,
        }
      : settings;

  return {
    type: input.type,
    ...normalizedSettings,
    ...(branch === undefined || branch === null ? {} : { branch }),
  };
};

const stepData = ({
  atomicAppend = false,
  input,
  name,
  position,
  sequenceId,
}: {
  atomicAppend?: boolean;
  input: SequenceStepInput;
  name?: string | null;
  position?: number;
  sequenceId?: string;
}): Record<string, unknown> =>
  compactRecord([
    ['sequenceId', sequenceId],
    ['name', name],
    ['type', getSequenceStepStorageType(input.type)],
    [
      'settings',
      {
        ...normalizedStepSettings(input),
        ...(atomicAppend ? { [SEQUENCE_STEP_ATOMIC_APPEND_MARKER]: true } : {}),
      },
    ],
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

const withPreservedStepSettings = ({
  currentStep,
  input,
}: {
  currentStep: unknown;
  input: SequenceStepUpdateInput;
}): SequenceStepInput => {
  const currentSettings = getStepSettings(currentStep);
  const currentBranch = currentSettings.branch;
  const preservedBranch =
    input.settings.branch !== undefined || !isRecord(currentBranch)
      ? input.settings.branch
      : (currentBranch as z.infer<typeof sequenceStepBranchSchema>);
  const currentType = currentSettings.type;
  const mergedSettings: UnknownRecord = {
    ...(currentType === input.type ? currentSettings : {}),
    ...input.settings,
    ...(preservedBranch === undefined ? {} : { branch: preservedBranch }),
  };

  if (
    input.type === SEQUENCE_STEP_TYPES[0] &&
    'variants' in input.settings &&
    input.settings.variants === null
  ) {
    delete mergedSettings.variants;
  }

  return stepInputSchema.parse({
    type: input.type,
    settings: mergedSettings,
  });
};

const withPreservedStepBranch = withPreservedStepSettings;

const stepPatchData = ({
  currentStep,
  input,
  name,
}: {
  currentStep: unknown;
  input: SequenceStepUpdateInput;
  name?: string | null;
}): Record<string, unknown> => {
  const currentSettings = getStepSettings(currentStep);
  const currentType = currentSettings.type;

  if (typeof currentType !== 'string') {
    throw new Error('Twenty returned a sequence step without a settings type.');
  }

  const normalizedInput = withPreservedStepSettings({ currentStep, input });
  const isTypeChange = currentType !== input.type;
  const settingsPatch: UnknownRecord = isTypeChange
    ? normalizedStepSettings(normalizedInput)
    : {
        type: input.type,
        ...input.settings,
      };

  if (
    !isTypeChange &&
    input.type === SEQUENCE_STEP_TYPES[0] &&
    normalizedInput.type === SEQUENCE_STEP_TYPES[0] &&
    normalizedInput.settings.executionMode === 'MANUAL' &&
    input.settings.executionMode === 'MANUAL'
  ) {
    settingsPatch.threadAsReplyToPreviousEmail = false;
    settingsPatch.stopOnReply = false;
  }

  return compactRecord([
    ['name', name],
    ['type', getSequenceStepStorageType(input.type)],
    [
      'settings',
      {
        ...settingsPatch,
        [SEQUENCE_SETTINGS_ATOMIC_PATCH_MARKER]: true,
        [SEQUENCE_STEP_SETTINGS_PATCH_BASE_TYPE]: currentType,
      },
    ],
  ]);
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

type SequenceMutationCapabilities = {
  atomicSettingsPatch: boolean;
  atomicSettingsPatchVersion: number;
  atomicStepAppend: boolean;
  atomicStepAppendVersion: number;
};

type SequenceEnrollmentStartStepCapabilities = {
  enrollmentStartStep: boolean;
  enrollmentStartStepVersion: number;
};

const getSequenceMutationCapabilities = async (
  client: TwentyClient,
): Promise<SequenceMutationCapabilities> => {
  let result: {
    sequenceMutationCapabilities: SequenceMutationCapabilities;
  };

  try {
    result = await client.graphql(
      SEQUENCE_MUTATION_CAPABILITIES_QUERY,
      {},
      { endpoint: 'metadata' },
    );
  } catch (error) {
    throw new TwentyApiError({
      message:
        'This Twenty backend does not advertise concurrency-safe sequence patches. Upgrade the backend before changing sequence or step settings.',
      code: 'SEQUENCE_ATOMIC_PATCH_UNSUPPORTED',
      details: error,
    });
  }

  return result.sequenceMutationCapabilities;
};

const assertAtomicSequencePatchSupported = async (
  client: TwentyClient,
): Promise<void> => {
  const capabilities = await getSequenceMutationCapabilities(client);

  if (
    capabilities.atomicSettingsPatch !== true ||
    capabilities.atomicSettingsPatchVersion !== 1
  ) {
    throw new TwentyApiError({
      message:
        'This Twenty backend does not support the required concurrency-safe sequence patch protocol version 1. Upgrade the backend before changing sequence or step settings.',
      code: 'SEQUENCE_ATOMIC_PATCH_UNSUPPORTED',
      details: capabilities,
    });
  }
};

const assertAtomicStepAppendSupported = async (
  client: TwentyClient,
): Promise<void> => {
  const capabilities = await getSequenceMutationCapabilities(client);

  if (
    capabilities.atomicStepAppend !== true ||
    capabilities.atomicStepAppendVersion !== 1
  ) {
    throw new TwentyApiError({
      message:
        'This Twenty backend does not support the required concurrency-safe sequence step append protocol version 1. Upgrade the backend or provide an explicit position.',
      code: 'SEQUENCE_ATOMIC_APPEND_UNSUPPORTED',
      details: capabilities,
    });
  }
};

const assertEnrollmentStartStepSupported = async (
  client: TwentyClient,
): Promise<void> => {
  let result: {
    sequenceMutationCapabilities: SequenceEnrollmentStartStepCapabilities;
  };

  try {
    result = await client.graphql(
      SEQUENCE_ENROLLMENT_START_STEP_CAPABILITIES_QUERY,
      {},
      { endpoint: 'metadata' },
    );
  } catch (error) {
    throw new TwentyApiError({
      message:
        'This Twenty backend does not advertise enrollment at a selected starting step. Upgrade the backend before using start_step_id.',
      code: 'SEQUENCE_ENROLLMENT_START_STEP_UNSUPPORTED',
      details: error,
    });
  }

  const capabilities = result.sequenceMutationCapabilities;

  if (
    capabilities.enrollmentStartStep !== true ||
    capabilities.enrollmentStartStepVersion !== 1
  ) {
    throw new TwentyApiError({
      message:
        'This Twenty backend does not support the required enrollment starting-step protocol version 1. Upgrade the backend before using start_step_id.',
      code: 'SEQUENCE_ENROLLMENT_START_STEP_UNSUPPORTED',
      details: capabilities,
    });
  }
};

const listAllSequenceEnrollments = async ({
  records,
  sequenceId,
}: {
  records: RecordsService;
  sequenceId: string;
}): Promise<unknown[]> => {
  const enrollments: unknown[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await records.list({
      object: STANDARD_OBJECTS.sequenceEnrollments,
      filter: filterCondition('sequenceId', 'eq', sequenceId),
      limit: MAX_LIST_LIMIT,
      startingAfter,
    });

    enrollments.push(...page.items);
    startingAfter =
      page.has_more && page.next_cursor !== null ? page.next_cursor : undefined;
  } while (startingAfter !== undefined);

  return enrollments;
};

const getSequenceValidationSteps = (
  steps: unknown[],
): SequenceValidationStep[] =>
  steps
    .flatMap((step) => {
      if (!isRecord(step) || typeof step.id !== 'string') {
        return [];
      }

      return [
        {
          id: step.id,
          name: typeof step.name === 'string' ? step.name : null,
          position: typeof step.position === 'number' ? step.position : 0,
          createdAt: typeof step.createdAt === 'string' ? step.createdAt : '',
          settings: isRecord(step.settings) ? step.settings : {},
        },
      ];
    })
    .sort((first, second) => compareSequenceValidationSteps(first, second));

const getSequenceValidationBranch = (
  step: SequenceValidationStep,
): SequenceValidationBranch | undefined => {
  const branch = step.settings.branch;

  return isRecord(branch) &&
    typeof branch.conditionStepId === 'string' &&
    typeof branch.outcome === 'string'
    ? {
        conditionStepId: branch.conditionStepId,
        outcome: branch.outcome,
      }
    : undefined;
};

const isSameSequenceValidationBranch = (
  first: SequenceValidationBranch | undefined,
  second: SequenceValidationBranch | undefined,
): boolean =>
  first?.conditionStepId === second?.conditionStepId &&
  first?.outcome === second?.outcome;

function compareSequenceValidationSteps(
  first: SequenceValidationStep,
  second: SequenceValidationStep,
): number {
  if (first.position !== second.position) {
    return first.position - second.position;
  }

  const createdAtComparison = first.createdAt.localeCompare(second.createdAt);

  return createdAtComparison !== 0
    ? createdAtComparison
    : first.id.localeCompare(second.id);
}

const findNextSequenceValidationStep = ({
  currentStep,
  steps,
  visitedStepIds = new Set<string>(),
}: {
  currentStep: SequenceValidationStep;
  steps: SequenceValidationStep[];
  visitedStepIds?: Set<string>;
}): SequenceValidationStep | undefined => {
  if (visitedStepIds.has(currentStep.id)) {
    return undefined;
  }

  const nextVisitedStepIds = new Set(visitedStepIds).add(currentStep.id);
  const currentBranch = getSequenceValidationBranch(currentStep);
  const nextSibling = steps.find(
    (step) =>
      compareSequenceValidationSteps(step, currentStep) > 0 &&
      isSameSequenceValidationBranch(
        getSequenceValidationBranch(step),
        currentBranch,
      ),
  );

  if (nextSibling !== undefined) {
    return nextSibling;
  }

  if (currentBranch === undefined) {
    return undefined;
  }

  const parentCondition = steps.find(
    (step) => step.id === currentBranch.conditionStepId,
  );

  return parentCondition === undefined
    ? undefined
    : findNextSequenceValidationStep({
        currentStep: parentCondition,
        steps,
        visitedStepIds: nextVisitedStepIds,
      });
};

const getSequenceValidationWarnings = (steps: unknown[]): string[] => {
  const validationSteps = getSequenceValidationSteps(steps);
  const pointInTimeConditionByActionType = new Map([
    ['SEND_CONNECTION_REQUEST', 'ACCEPTED_LINKEDIN_INVITE'],
    ['SEND_LINKEDIN_MESSAGE', 'OPENED_LINKEDIN_MESSAGE'],
  ]);
  const warnings: string[] = [];

  for (const step of validationSteps) {
    const pointInTimeCondition = pointInTimeConditionByActionType.get(
      typeof step.settings.type === 'string' ? step.settings.type : '',
    );

    if (pointInTimeCondition === undefined) {
      continue;
    }

    const nextStep = findNextSequenceValidationStep({
      currentStep: step,
      steps: validationSteps,
    });

    if (
      nextStep?.settings.type !== 'CONDITION' ||
      nextStep.settings.condition !== pointInTimeCondition
    ) {
      continue;
    }

    warnings.push(
      `Condition step ${nextStep.id} checks ${pointInTimeCondition} immediately after ${step.settings.type} step ${step.id}. This is a point-in-time check; add a DELAY before the condition if the external event needs time to occur.`,
    );
  }

  return warnings;
};

const getSequenceAnalyticsReplyRate = ({
  repliedCount,
  sentCount,
}: {
  repliedCount: number;
  sentCount: number;
}): number => (sentCount === 0 ? 0 : (repliedCount / sentCount) * 100);

const getSequenceAnalyticsSteps = (steps: unknown[]): SequenceAnalyticsStep[] =>
  steps.flatMap((step) => {
    if (!isRecord(step) || typeof step.id !== 'string') {
      return [];
    }

    return [
      {
        id: step.id,
        name: typeof step.name === 'string' ? step.name : null,
        position: typeof step.position === 'number' ? step.position : 0,
        settings: isRecord(step.settings) ? step.settings : {},
      },
    ];
  });

const getSequenceEmailVariantDefinitions = (
  settings: UnknownRecord,
): Array<{ id: string; name: string }> => {
  if (Array.isArray(settings.variants) && settings.variants.length > 0) {
    const variants = settings.variants.flatMap((variant) =>
      isRecord(variant) &&
      typeof variant.id === 'string' &&
      typeof variant.name === 'string'
        ? [{ id: variant.id, name: variant.name }]
        : [],
    );

    if (variants.length > 0) {
      return variants;
    }
  }

  return [
    {
      id: DEFAULT_SEQUENCE_EMAIL_VARIANT_ID,
      name: DEFAULT_SEQUENCE_EMAIL_VARIANT_NAME,
    },
  ];
};

const buildSequenceAnalyticsFallback = ({
  enrollments,
  steps,
}: {
  enrollments: unknown[];
  steps: unknown[];
}): SequenceAnalytics => {
  const analyticsSteps = getSequenceAnalyticsSteps(steps);
  const stepsById = new Map(analyticsSteps.map((step) => [step.id, step]));
  const buckets = new Map<string, SequenceEmailVariantAnalytics>();

  for (const step of analyticsSteps) {
    if (step.settings.type !== SEQUENCE_STEP_TYPES[0]) {
      continue;
    }

    const stepName = step.name ?? `Email step ${step.position + 1}`;

    for (const variant of getSequenceEmailVariantDefinitions(step.settings)) {
      buckets.set(`${step.id}:${variant.id}`, {
        stepId: step.id,
        stepName,
        variantId: variant.id,
        variantName: variant.name,
        sentCount: 0,
        repliedCount: 0,
        replyRate: 0,
      });
    }
  }

  let contactedCount = 0;
  let sentEmailCount = 0;
  let repliedCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const enrollmentValue of enrollments) {
    const enrollment = isRecord(enrollmentValue) ? enrollmentValue : {};
    const sentEmailsByStepId = isRecord(enrollment.sentEmailsByStepId)
      ? enrollment.sentEmailsByStepId
      : {};
    const sentEntries = Object.entries(sentEmailsByStepId);
    let hasEmailReply = false;

    if (sentEntries.length > 0) {
      contactedCount += 1;
    }

    sentEmailCount += sentEntries.length;

    for (const [stepId, metadataValue] of sentEntries) {
      const metadata = isRecord(metadataValue) ? metadataValue : {};
      const variantId =
        typeof metadata.variantId === 'string'
          ? metadata.variantId
          : DEFAULT_SEQUENCE_EMAIL_VARIANT_ID;
      const variantName =
        typeof metadata.variantName === 'string'
          ? metadata.variantName
          : DEFAULT_SEQUENCE_EMAIL_VARIANT_NAME;
      const key = `${stepId}:${variantId}`;
      const existingBucket = buckets.get(key);
      const bucket =
        existingBucket ??
        ({
          stepId,
          stepName: stepsById.get(stepId)?.name ?? 'Email step',
          variantId,
          variantName,
          sentCount: 0,
          repliedCount: 0,
          replyRate: 0,
        } satisfies SequenceEmailVariantAnalytics);

      bucket.sentCount += 1;

      if (metadata.repliedAt !== undefined) {
        bucket.repliedCount += 1;
        hasEmailReply = true;
      }

      buckets.set(key, bucket);
    }

    if (enrollment.status === 'REPLIED' || hasEmailReply) {
      repliedCount += 1;
    }

    if (enrollment.status === 'COMPLETED') {
      completedCount += 1;
    }

    if (enrollment.status === 'FAILED') {
      failedCount += 1;
    }
  }

  const emailVariants = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      replyRate: getSequenceAnalyticsReplyRate({
        repliedCount: bucket.repliedCount,
        sentCount: bucket.sentCount,
      }),
    }))
    .sort((first, second) => {
      const firstPosition = stepsById.get(first.stepId)?.position ?? 0;
      const secondPosition = stepsById.get(second.stepId)?.position ?? 0;

      return (
        firstPosition - secondPosition ||
        first.variantName.localeCompare(second.variantName)
      );
    });

  return {
    enrolledCount: enrollments.length,
    contactedCount,
    sentEmailCount,
    repliedCount,
    completedCount,
    failedCount,
    replyRate: getSequenceAnalyticsReplyRate({
      repliedCount,
      sentCount: enrollments.length,
    }),
    emailVariants,
  };
};

const isSequenceAnalyticsResolverUnavailable = (error: unknown): boolean =>
  error instanceof TwentyApiError &&
  error.code === 'GRAPHQL_ERROR' &&
  /Cannot query field ["']sequenceAnalytics["']/i.test(error.message);

const getSequenceAnalytics = async ({
  client,
  records,
  sequenceId,
}: {
  client: ToolDependencies['client'];
  records: RecordsService;
  sequenceId: string;
}): Promise<unknown> => {
  try {
    const result = await client.graphql<{
      sequenceAnalytics: unknown;
    }>(SEQUENCE_ANALYTICS_QUERY, { sequenceId }, { endpoint: 'metadata' });

    return result.sequenceAnalytics;
  } catch (error) {
    if (!isSequenceAnalyticsResolverUnavailable(error)) {
      throw error;
    }

    const [steps, enrollments] = await Promise.all([
      listAllSequenceSteps({ records, sequenceId }),
      listAllSequenceEnrollments({ records, sequenceId }),
    ]);

    return buildSequenceAnalyticsFallback({ enrollments, steps });
  }
};

const createSequenceData = ({
  name,
  settings,
  senderConnectedAccountId,
}: {
  name: string;
  settings?: Partial<z.infer<typeof sequenceSettingsSchema>>;
  senderConnectedAccountId?: string;
}): Record<string, unknown> => {
  const senderConnectedAccountIds =
    settings?.senderConnectedAccountIds ??
    (senderConnectedAccountId === undefined ? [] : [senderConnectedAccountId]);

  if (
    senderConnectedAccountId !== undefined &&
    settings?.senderConnectedAccountIds !== undefined &&
    senderConnectedAccountIds[0] !== senderConnectedAccountId
  ) {
    throw new Error(
      'sender_connected_account_id must match the first settings.senderConnectedAccountIds entry.',
    );
  }

  return {
    name,
    settings: {
      ...DEFAULT_SEQUENCE_SETTINGS,
      ...settings,
      senderConnectedAccountIds,
    },
    ...(senderConnectedAccountIds[0] === undefined
      ? {}
      : { senderConnectedAccountId: senderConnectedAccountIds[0] }),
  };
};

const sequencePatchData = ({
  name,
  senderConnectedAccountId,
  settings,
}: {
  name?: string;
  senderConnectedAccountId?: string | null;
  settings?: z.infer<typeof sequenceSettingsPatchSchema>;
}): Record<string, unknown> => {
  const shouldUpdateSettings =
    settings !== undefined || senderConnectedAccountId !== undefined;

  if (!shouldUpdateSettings) {
    return compactRecord([['name', name]]);
  }

  const hasSenderPoolPatch =
    settings !== undefined &&
    Object.prototype.hasOwnProperty.call(settings, 'senderConnectedAccountIds');
  const senderConnectedAccountIds = hasSenderPoolPatch
    ? (settings?.senderConnectedAccountIds ?? [])
    : senderConnectedAccountId !== undefined
      ? senderConnectedAccountId === null
        ? []
        : [senderConnectedAccountId]
      : undefined;
  const mirroredSenderConnectedAccountId =
    senderConnectedAccountIds?.[0] ?? null;

  if (
    hasSenderPoolPatch &&
    senderConnectedAccountId !== undefined &&
    senderConnectedAccountId !== mirroredSenderConnectedAccountId
  ) {
    throw new Error(
      'sender_connected_account_id must match the first settings.senderConnectedAccountIds entry.',
    );
  }

  return compactRecord([
    ['name', name],
    [
      'settings',
      {
        ...settings,
        ...(senderConnectedAccountIds === undefined
          ? {}
          : { senderConnectedAccountIds }),
        [SEQUENCE_SETTINGS_ATOMIC_PATCH_MARKER]: true,
      },
    ],
    [
      'senderConnectedAccountId',
      senderConnectedAccountIds === undefined
        ? undefined
        : mirroredSenderConnectedAccountId,
    ],
  ]);
};

const mergeSequenceUpdateData = sequencePatchData;

const SEQUENCE_CAPABILITIES = {
  server_version: SERVER_VERSION,
  contract_version: SEQUENCE_MCP_CONTRACT_VERSION,
  lifecycle: {
    statuses: SEQUENCE_STATUSES,
    activation_requirements: [
      'At least one step.',
      'At least one active sending day.',
      'A synchronized sender mailbox for automated outbound email. LinkedIn steps and conditions require an active sender account owned by a workspace member, but do not depend on inbox sync.',
      'Explicit confirmation because activation can start external outreach.',
    ],
    editing:
      'Pause the sequence before changing settings. Sender and step changes also require active enrollments to finish.',
    scheduled_activation:
      'Twenty has no one-shot activation date. To start tomorrow, call twenty_set_sequence_status tomorrow or use an external scheduler.',
    archive:
      'twenty_archive_sequence removes open enrollments, completes their open tasks, cancels scheduled LinkedIn actions, and releases eligible enrichment claims. Already-claimed external work may still finish. Restore preserves that history rather than restarting it.',
  },
  sequence_settings: {
    defaults: DEFAULT_SEQUENCE_SETTINGS,
    active_days:
      'Integers 0-6 where 0 is Sunday. At least one day is required before activation.',
    sending_window:
      'All window fields are HH:mm. windowStart/windowEnd control enrollment admission, LinkedIn steps, calls, and other non-email work in settings.timezone. emailWindowStart/emailWindowEnd control automated email delivery and manual email task surfacing. Email steps use settings.timezone in SEQUENCE mode; RECIPIENT mode uses the Person timeZone field and falls back to UTC when it is missing or invalid. For legacy settings without email window fields, email steps inherit windowStart/windowEnd. start > end is an overnight window whose after-midnight portion belongs to the previous active day; equal start/end means all day.',
    daily_start_limit:
      'dailyStartLimitEnabled controls whether dailyStarts limits pending admissions. RECIPIENT mode resets the quota at UTC midnight; SEQUENCE mode resets it at midnight in settings.timezone.',
    daily_starts:
      'Maximum pending enrollments admitted during each quota day: UTC in RECIPIENT mode, or settings.timezone in SEQUENCE mode.',
    stagger_minutes:
      'Minimum spacing used when scheduling automated email starts.',
    sender_pool:
      'senderConnectedAccountIds is an optional pool of sender accounts. Automated email requires synchronized mailboxes; LinkedIn-only sequences require active accounts owned by workspace members. Each enrollment is assigned one account when admitted and remains pinned to it for threading and sender identity.',
    linkedin_limits:
      'linkedinDailyActionLimitEnabled controls only the daily action cap, which accepts 1-40 actions per LinkedIn account per UTC day. The sending window and per-account delay pattern are always enforced.',
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
      'Conditions are point-in-time checks: they do not wait or re-evaluate. The raw result is compared with settings.expected (default true). The resulting match enters YES and the opposite result enters NO. Each lane runs by global position, then merges into the next root step. Add a delay before invite-accepted or message-opened checks when the external event needs time to occur. Nested conditions are not supported by the current builder.',
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
        'variants',
        'threadAsReplyToPreviousEmail',
        'stopOnReply',
      ],
      automated:
        'Sends through the enrollment mailbox. When variants are present, Twenty makes a deterministic weighted assignment and keeps attribution for reply-rate analytics. Subject and body support deterministic spintax such as {Hi|Hello}; template variables remain {{variableName}}.',
      manual:
        'Creates an EMAIL task and waits for completion. Manual sends do not create trusted sent-message or thread metadata, so threadAsReplyToPreviousEmail and stopOnReply must be false; handle replies and stopping manually.',
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
      fields: ['condition', 'expected'],
      expectation:
        'expected defaults to true. Set it to false when the Yes path should be selected when the condition does not match.',
      conditions: {
        IS_IN_LINKEDIN_NETWORK:
          'True for a synced or recorded first-degree LinkedIn connection.',
        HAS_EMAIL_ADDRESS: 'True when the person has a primary email.',
        HAS_LINKEDIN_URL:
          'True when the person has a valid LinkedIn profile URL.',
        ACCEPTED_LINKEDIN_INVITE:
          'True only when the person is a synced or recorded first-degree connection and this workspace/sender has evidence that it previously sent the invitation, accounting for withdrawals.',
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
      'Enroll one or more people at a selected root step. Earlier steps are intentionally bypassed, and condition steps evaluate immediately when admitted.',
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
    'twenty_validate_sequence',
    {
      title: 'Validate sequence activation readiness',
      description:
        'Runs the server activation-readiness invariants and workspace feature-flag check without changing sequence state. Returns the workspace feature-flag blocker, when present, and the first activation-invariant blocker, plus warnings for point-in-time LinkedIn conditions that immediately follow the action they observe. Call before activation.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ sequence_id, response_format }) =>
      runTool(async () => {
        const [result, steps] = await Promise.all([
          dependencies.client.graphql<{
            sequenceReadiness: { ready: boolean; errors: string[] };
          }>(
            SEQUENCE_READINESS_QUERY,
            { sequenceId: sequence_id },
            { endpoint: 'metadata' },
          ),
          listAllSequenceSteps({ records, sequenceId: sequence_id }),
        ]);

        return {
          ...result.sequenceReadiness,
          warnings: getSequenceValidationWarnings(steps),
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_list_connected_accounts',
    {
      title: 'List connected sender accounts',
      description:
        'Lists user-owned connected accounts for sequences or one-off email. SEQUENCE includes supported, unarchived accounts even when mailbox authentication or inbox sync is not ready, so LinkedIn-only sequences can select them. EMAIL requires valid authentication and an enabled ACTIVE inbox. Each result reports sequenceSenderEligible and sequenceEmailReady. Requires TWENTY_USER_TOKEN.',
      inputSchema: z.object({
        provider: z.string().min(1).optional(),
        use_case: z.enum(['SEQUENCE', 'EMAIL']).default('SEQUENCE'),
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
    async ({ provider, use_case, active_only, response_format }) =>
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
          (account) => {
            const accountWithMessageChannels = {
              ...account,
              messageChannels:
                typeof account.id === 'string'
                  ? (messageChannelsByConnectedAccountId.get(account.id) ?? [])
                  : [],
            };

            return {
              ...accountWithMessageChannels,
              sequenceSenderEligible: isSequenceSenderAccount(
                accountWithMessageChannels,
              ),
              sequenceEmailReady: isReadySequenceEmailSenderAccount(
                accountWithMessageChannels,
              ),
            };
          },
        );

        return filterConnectedAccounts(accountsWithMessageChannels, {
          activeOnly: active_only,
          provider,
          useCase: use_case,
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
    'twenty_update_sequence_mailbox_limit',
    {
      title: 'Update a sequence mailbox daily limit',
      description:
        'Enables, disables, or changes the hard per-mailbox sequence email cap. The cap is shared by every sequence using the mailbox and resets at 00:00 UTC. Requires TWENTY_USER_TOKEN and explicit confirmation because increasing a limit can accelerate outreach.',
      inputSchema: z.object({
        connected_account_id: recordIdSchema,
        enabled: z.boolean(),
        daily_limit: z.number().int().min(1).max(200),
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
    async ({
      connected_account_id,
      enabled,
      daily_limit,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Mailbox limit update not performed: confirm the mailbox and daily limit first.',
          );
        }

        const result = await dependencies.client.graphql<{
          updateConnectedAccountSequenceEmailSettings: unknown;
        }>(
          UPDATE_SEQUENCE_MAILBOX_LIMIT_MUTATION,
          {
            id: connected_account_id,
            input: {
              sequenceDailyEmailLimitEnabled: enabled,
              sequenceDailyEmailLimit: daily_limit,
            },
          },
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.updateConnectedAccountSequenceEmailSettings;
      }, response_format),
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
        starting_after: z.string().optional(),
        ending_before: z.string().optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ status, limit, starting_after, ending_before, response_format }) =>
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
            startingAfter: starting_after,
            endingBefore: ending_before,
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
        'Creates a DRAFT sequence with safe weekday/business-hour defaults unless settings are supplied. settings.senderConnectedAccountIds is the canonical sender pool; the legacy sender field is mirrored automatically.',
      inputSchema: z.object({
        name: z.string().min(1),
        settings: sequenceSettingsSchema.partial().optional(),
        sender_connected_account_id: recordIdSchema.optional(),
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
        'Patches a sequence name, settings, or sender pool while preserving every omitted setting. settings.senderConnectedAccountIds is canonical and the legacy sender field is mirrored automatically. Twenty requires pausing before settings changes when active.',
      inputSchema: z
        .object({
          sequence_id: recordIdSchema,
          name: z.string().min(1).optional(),
          settings: sequenceSettingsPatchSchema.optional(),
          sender_connected_account_id: recordIdSchema.nullable().optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ name, sender_connected_account_id, settings }) =>
            name !== undefined ||
            sender_connected_account_id !== undefined ||
            settings !== undefined,
          'Provide name, settings, and/or sender_connected_account_id.',
        ),
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
      runTool(async () => {
        if (
          settings !== undefined ||
          sender_connected_account_id !== undefined
        ) {
          await assertAtomicSequencePatchSupported(dependencies.client);
        }

        return records.update({
          object: STANDARD_OBJECTS.sequences,
          id: sequence_id,
          data: sequencePatchData({
            name,
            settings,
            senderConnectedAccountId: sender_connected_account_id,
          }),
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_set_sequence_status',
    {
      title: 'Set outreach sequence status',
      description:
        'Activates, pauses, or returns a sequence to DRAFT. Activation requires at least one step and one active sending day. Every selected sender account must be active, owned, and supported; automated email additionally requires authentication and active inbox sync for every selected account, while LinkedIn-only outreach does not require inbox sync.',
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
    'twenty_archive_sequence',
    {
      title: 'Archive an outreach sequence',
      description:
        'Moves a sequence to trash. Twenty removes pending/active enrollments, completes their open tasks, cancels scheduled LinkedIn actions, and releases eligible enrichment claims; already-claimed external work may still finish. Requires confirmation.',
      inputSchema: z.object({
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
    async ({ sequence_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Sequence archive not performed: confirm the sequence and lifecycle effects first.',
          );
        }

        return records.softDelete(STANDARD_OBJECTS.sequences, sequence_id);
      }, response_format),
  );

  server.registerTool(
    'twenty_restore_sequence',
    {
      title: 'Restore an archived outreach sequence',
      description:
        'Restores an archived sequence by ID. Previously removed enrollments and completed tasks remain historical and are not restarted. Confirm the sequence before restoring it.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ sequence_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Sequence restore not performed: confirm the archived sequence first.',
          );
        }

        return records.restore(STANDARD_OBJECTS.sequences, sequence_id);
      }, response_format),
  );

  if (dependencies.enableAdvanced) {
    server.registerTool(
      'twenty_destroy_sequence',
      {
        title: 'Permanently destroy an archived outreach sequence',
        description:
          'Permanently and irreversibly destroys an archived sequence and its retained graph/history according to Twenty cascade rules. Archive first and require exact confirmation.',
        inputSchema: z.object({
          sequence_id: recordIdSchema,
          confirm: z.literal(true).describe(CONFIRMATION_DESCRIPTION),
          response_format: responseFormatSchema,
        }),
        outputSchema: TOOL_OUTPUT_SCHEMA,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      async ({ sequence_id, response_format }) =>
        runTool(
          () => records.destroy(STANDARD_OBJECTS.sequences, sequence_id),
          response_format,
        ),
    );
  }

  server.registerTool(
    'twenty_add_sequence_step',
    {
      title: 'Add an outreach sequence step',
      description:
        'Adds any current sequence step: email, delay, task, LinkedIn action, condition, or phone enrichment. Put an action in a Yes/No lane with settings.branch={conditionStepId,outcome}. Action-capable steps accept AUTOMATED or MANUAL execution. Omitted position appends after the current global maximum. The sequence must not be active.',
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

        if (position === undefined) {
          await assertAtomicStepAppendSupported(dependencies.client);
        }

        return records.create({
          object: STANDARD_OBJECTS.sequenceSteps,
          data: stepData({
            input: step,
            atomicAppend: position === undefined,
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
        'Patches the type/settings/name of a step while preserving every omitted setting. Omitted settings.branch preserves its current lane; null moves it to the root flow. Pass variants=null to remove an email A/B test. The containing sequence must not be active.',
      inputSchema: z
        .object({
          step_id: recordIdSchema,
          name: z.string().nullable().optional(),
          step: stepUpdateInputSchema.optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ name, step }) => name !== undefined || step !== undefined,
          'Provide name and/or step.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ step_id, name, step, response_format }) =>
      runTool(async () => {
        if (step === undefined) {
          return records.update({
            object: STANDARD_OBJECTS.sequenceSteps,
            id: step_id,
            data: { name },
          });
        }

        await assertAtomicSequencePatchSupported(dependencies.client);

        const currentStep = await records.get({
          object: STANDARD_OBJECTS.sequenceSteps,
          id: step_id,
        });
        const input = withPreservedStepSettings({ currentStep, input: step });

        await assertBranchTarget({
          branch: input.settings.branch,
          records,
          sequenceId: getStepSequenceId(currentStep),
        });

        return records.update({
          object: STANDARD_OBJECTS.sequenceSteps,
          id: step_id,
          data: stepPatchData({ currentStep, input: step, name }),
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
        position: sequenceStepPositionSchema,
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
        idempotentHint: false,
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
        start_step_id: recordIdSchema
          .optional()
          .describe(
            'Optional root step to execute first. Earlier steps are bypassed. Branch-child steps are rejected.',
          ),
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
    async ({
      person_id,
      sequence_id,
      start_step_id,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Enrollment not performed: confirm the person and sequence first.',
          );
        }

        if (start_step_id !== undefined) {
          await assertEnrollmentStartStepSupported(dependencies.client);
        }

        return records.create({
          object: STANDARD_OBJECTS.sequenceEnrollments,
          data: {
            personId: person_id,
            sequenceId: sequence_id,
            ...(start_step_id === undefined
              ? {}
              : { currentStepId: start_step_id }),
          },
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
        person_ids: z
          .array(recordIdSchema)
          .min(1)
          .max(100)
          .refine(
            (personIds) => new Set(personIds).size === personIds.length,
            'person_ids cannot contain duplicates.',
          ),
        sequence_id: recordIdSchema,
        start_step_id: recordIdSchema
          .optional()
          .describe(
            'Optional root step to execute first for every person. Earlier steps are bypassed. Branch-child steps are rejected.',
          ),
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
    async ({
      person_ids,
      sequence_id,
      start_step_id,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Bulk enrollment not performed: confirm the full recipient set and sequence first.',
          );
        }

        if (start_step_id !== undefined) {
          await assertEnrollmentStartStepSupported(dependencies.client);
        }

        const results = await Promise.allSettled(
          person_ids.map((personId) =>
            records.create({
              object: STANDARD_OBJECTS.sequenceEnrollments,
              data: {
                personId,
                sequenceId: sequence_id,
                ...(start_step_id === undefined
                  ? {}
                  : { currentStepId: start_step_id }),
              },
            }),
          ),
        );

        return {
          sequence_id,
          start_step_id: start_step_id ?? null,
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
        starting_after: z.string().optional(),
        ending_before: z.string().optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      sequence_id,
      person_id,
      status,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) =>
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
            startingAfter: starting_after,
            endingBefore: ending_before,
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
        idempotentHint: false,
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
        idempotentHint: false,
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
        idempotentHint: false,
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
        'Returns the existing sequence counters and enrollment status groups, plus funnel totals, reply rate, and per-step/per-variant analytics.',
      inputSchema: z.object({
        sequence_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ sequence_id, response_format }) =>
      runTool(async () => {
        const [sequence, enrollmentGroups, analytics] = await Promise.all([
          records.get({
            object: STANDARD_OBJECTS.sequences,
            id: sequence_id,
          }),
          records.groupBy({
            object: STANDARD_OBJECTS.sequenceEnrollments,
            groupBy: [{ status: true }],
            aggregate: ['countNotEmptyId'],
            filter: filterCondition('sequenceId', 'eq', sequence_id),
          }),
          getSequenceAnalytics({
            client: dependencies.client,
            records,
            sequenceId: sequence_id,
          }),
        ]);

        return {
          sequence,
          enrollments_by_status: enrollmentGroups,
          analytics,
        };
      }, response_format),
  );
};

export const sequencesToolsTesting = {
  createSequenceData,
  findDescendantStepIds,
  filterConnectedAccounts,
  getSequenceStepStorageType,
  isReadySequenceEmailSenderAccount,
  isSequenceSenderAccount,
  mergeSequenceUpdateData,
  normalizedStepSettings,
  sequenceCapabilities: SEQUENCE_CAPABILITIES,
  sequenceSettingsPatchSchema,
  sequenceSettingsSchema,
  sequenceStepPositionSchema,
  stepData,
  stepPatchData,
  stepInputSchema,
  stepUpdateInputSchema,
  withPreservedStepBranch,
  withPreservedStepSettings,
};
