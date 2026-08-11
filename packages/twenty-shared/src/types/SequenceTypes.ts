export const SEQUENCE_STATUSES = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
} as const;

export type SequenceStatus =
  (typeof SEQUENCE_STATUSES)[keyof typeof SEQUENCE_STATUSES];

export const SEQUENCE_STEP_TYPES = {
  SEND_EMAIL: 'SEND_EMAIL',
  DELAY: 'DELAY',
  CREATE_TASK: 'CREATE_TASK',
  SEND_CONNECTION_REQUEST: 'SEND_CONNECTION_REQUEST',
  SEND_LINKEDIN_MESSAGE: 'SEND_LINKEDIN_MESSAGE',
  WITHDRAW_CONNECTION_REQUEST: 'WITHDRAW_CONNECTION_REQUEST',
  CONDITION: 'CONDITION',
  ENRICH_PHONE_NUMBER: 'ENRICH_PHONE_NUMBER',
} as const;

export type SequenceStepType =
  (typeof SEQUENCE_STEP_TYPES)[keyof typeof SEQUENCE_STEP_TYPES];

export const SEQUENCE_ACTION_EXECUTION_MODES = {
  AUTOMATED: 'AUTOMATED',
  MANUAL: 'MANUAL',
} as const;

export type SequenceActionExecutionMode =
  (typeof SEQUENCE_ACTION_EXECUTION_MODES)[keyof typeof SEQUENCE_ACTION_EXECUTION_MODES];

export const SEQUENCE_CONDITION_TYPES = {
  IS_IN_LINKEDIN_NETWORK: 'IS_IN_LINKEDIN_NETWORK',
  HAS_EMAIL_ADDRESS: 'HAS_EMAIL_ADDRESS',
  HAS_LINKEDIN_URL: 'HAS_LINKEDIN_URL',
  ACCEPTED_LINKEDIN_INVITE: 'ACCEPTED_LINKEDIN_INVITE',
  OPENED_LINKEDIN_MESSAGE: 'OPENED_LINKEDIN_MESSAGE',
  HAS_PHONE_NUMBER: 'HAS_PHONE_NUMBER',
} as const;

export type SequenceConditionType =
  (typeof SEQUENCE_CONDITION_TYPES)[keyof typeof SEQUENCE_CONDITION_TYPES];

export const SEQUENCE_CONDITION_BRANCHES = {
  YES: 'YES',
  NO: 'NO',
} as const;

export type SequenceConditionBranch =
  (typeof SEQUENCE_CONDITION_BRANCHES)[keyof typeof SEQUENCE_CONDITION_BRANCHES];

export type SequenceStepBranch = {
  conditionStepId: string;
  outcome: SequenceConditionBranch;
};

export type SequenceStepPlacementSettings = {
  branch?: SequenceStepBranch;
};

export const SEQUENCE_ENROLLMENT_STATUSES = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  REPLIED: 'REPLIED',
  FAILED: 'FAILED',
  REMOVED: 'REMOVED',
} as const;

export type SequenceEnrollmentStatus =
  (typeof SEQUENCE_ENROLLMENT_STATUSES)[keyof typeof SEQUENCE_ENROLLMENT_STATUSES];

export const SEQUENCE_WAITING_ON = {
  DELAY: 'DELAY',
  EMAIL_SCHEDULED: 'EMAIL_SCHEDULED',
  TASK_DONE: 'TASK_DONE',
  TASK_DEADLINE: 'TASK_DEADLINE',
  LINKEDIN_ACTION: 'LINKEDIN_ACTION',
} as const;

export type SequenceWaitingOn =
  (typeof SEQUENCE_WAITING_ON)[keyof typeof SEQUENCE_WAITING_ON];

export const SEQUENCE_TASK_TYPES = {
  CALL: 'CALL',
  TODO: 'TODO',
  LINKEDIN_CONNECTION: 'LINKEDIN_CONNECTION',
  LINKEDIN_MESSAGE: 'LINKEDIN_MESSAGE',
  EMAIL: 'EMAIL',
  CUSTOM: 'CUSTOM',
} as const;

export type SequenceTaskType =
  (typeof SEQUENCE_TASK_TYPES)[keyof typeof SEQUENCE_TASK_TYPES];

export const TASK_PRIORITIES = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type TaskPriority =
  (typeof TASK_PRIORITIES)[keyof typeof TASK_PRIORITIES];

export type SequenceSettings = {
  activeDays: number[];
  windowStart: string;
  windowEnd: string;
  timezone: string;
  dailyStartLimitEnabled: boolean;
  dailyStarts: number;
  staggerMinutes: number;
  linkedinDailyActionLimitEnabled: boolean;
  linkedinDailyActions: number;
  linkedinDelayPatternMinutes: number[];
  stopOnReply: boolean;
};

export type SequenceActionExecutionSettings = SequenceStepPlacementSettings & {
  // Optional so sequences created before manual execution was introduced
  // continue to run in automated mode.
  executionMode?: SequenceActionExecutionMode;
  manualTaskTitle?: string;
  manualTaskDescription?: string;
};

export type SequenceEmailStepSettings = SequenceActionExecutionSettings & {
  type: typeof SEQUENCE_STEP_TYPES.SEND_EMAIL;
  subject: string;
  bodyHtml: string;
  threadAsReplyToPreviousEmail: boolean;
  stopOnReply: boolean | null;
};

export type SequenceDelayStepSettings = {
  branch?: SequenceStepBranch;
  type: typeof SEQUENCE_STEP_TYPES.DELAY;
  days: number;
  hours: number;
  minutes: number;
};

export type SequenceTaskContinueMode = 'IMMEDIATE' | 'ON_DONE' | 'ON_DEADLINE';

export type SequenceCreateTaskStepSettings = {
  branch?: SequenceStepBranch;
  type: typeof SEQUENCE_STEP_TYPES.CREATE_TASK;
  taskType: SequenceTaskType;
  titleTemplate: string;
  notesTemplate: string;
  priority: TaskPriority;
  assigneeWorkspaceMemberId: string | null;
  continueMode: SequenceTaskContinueMode;
  deadlineDays: number | null;
};

export type SequenceConnectionRequestStepSettings =
  SequenceActionExecutionSettings & {
    type: typeof SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST;
    noteTemplate: string;
  };

export type SequenceWithdrawConnectionRequestStepSettings =
  SequenceActionExecutionSettings & {
    type: typeof SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST;
    withdrawAfterDays: number;
    withdrawAfterHours: number;
  };

export type SequenceLinkedInMessageStepSettings =
  SequenceActionExecutionSettings & {
    type: typeof SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE;
    messageTemplate: string;
  };

export type SequenceConditionStepSettings = {
  branch?: SequenceStepBranch;
  type: typeof SEQUENCE_STEP_TYPES.CONDITION;
  condition: SequenceConditionType;
  expected?: boolean;
};

export type SequenceEnrichPhoneNumberStepSettings =
  SequenceActionExecutionSettings & {
    type: typeof SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER;
  };

export type SequenceStepSettings =
  | SequenceEmailStepSettings
  | SequenceDelayStepSettings
  | SequenceCreateTaskStepSettings
  | SequenceConnectionRequestStepSettings
  | SequenceLinkedInMessageStepSettings
  | SequenceWithdrawConnectionRequestStepSettings
  | SequenceConditionStepSettings
  | SequenceEnrichPhoneNumberStepSettings;
