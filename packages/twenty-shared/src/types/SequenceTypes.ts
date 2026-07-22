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
} as const;

export type SequenceStepType =
  (typeof SEQUENCE_STEP_TYPES)[keyof typeof SEQUENCE_STEP_TYPES];

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
  dailyStarts: number;
  staggerMinutes: number;
  linkedinDailyActions: number;
  linkedinDelayPatternMinutes: number[];
  stopOnReply: boolean;
};

export type SequenceEmailStepSettings = {
  type: typeof SEQUENCE_STEP_TYPES.SEND_EMAIL;
  subject: string;
  bodyHtml: string;
  threadAsReplyToPreviousEmail: boolean;
  stopOnReply: boolean | null;
};

export type SequenceDelayStepSettings = {
  type: typeof SEQUENCE_STEP_TYPES.DELAY;
  days: number;
  hours: number;
  minutes: number;
};

export type SequenceTaskContinueMode = 'IMMEDIATE' | 'ON_DONE' | 'ON_DEADLINE';

export type SequenceCreateTaskStepSettings = {
  type: typeof SEQUENCE_STEP_TYPES.CREATE_TASK;
  taskType: SequenceTaskType;
  titleTemplate: string;
  notesTemplate: string;
  priority: TaskPriority;
  assigneeWorkspaceMemberId: string | null;
  continueMode: SequenceTaskContinueMode;
  deadlineDays: number | null;
};

export type SequenceConnectionRequestStepSettings = {
  type: typeof SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST;
  noteTemplate: string;
  skipIfAlreadyConnected: boolean;
};

export type SequenceWithdrawConnectionRequestStepSettings = {
  type: typeof SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST;
  withdrawAfterDays: number;
  withdrawAfterHours: number;
};

export type SequenceLinkedInMessageStepSettings = {
  type: typeof SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE;
  messageTemplate: string;
};

export type SequenceStepSettings =
  | SequenceEmailStepSettings
  | SequenceDelayStepSettings
  | SequenceCreateTaskStepSettings
  | SequenceConnectionRequestStepSettings
  | SequenceLinkedInMessageStepSettings
  | SequenceWithdrawConnectionRequestStepSettings;
