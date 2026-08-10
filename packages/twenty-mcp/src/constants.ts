export const SERVER_NAME = 'twenty-mcp-server';
export const SERVER_VERSION = '0.2.0';

export const DEFAULT_CHARACTER_LIMIT = 25_000;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 3333;

export const REST_PATH = '/rest';
export const CORE_GRAPHQL_PATH = '/graphql';
export const METADATA_GRAPHQL_PATH = '/metadata';

export const STANDARD_OBJECTS = {
  attachments: 'attachments',
  companies: 'companies',
  dashboards: 'dashboards',
  linkedinActions: 'linkedinActions',
  linkedinConnections: 'linkedinConnections',
  linkedinInvitations: 'linkedinInvitations',
  linkedinMessages: 'linkedinMessages',
  linkedinMessageThreads: 'linkedinMessageThreads',
  linkedinThreadParticipants: 'linkedinThreadParticipants',
  messageThreads: 'messageThreads',
  messageDrafts: 'messageDrafts',
  notes: 'notes',
  noteTargets: 'noteTargets',
  opportunities: 'opportunities',
  people: 'people',
  recordListFolders: 'recordListFolders',
  recordListMembers: 'recordListMembers',
  recordLists: 'recordLists',
  sequenceEnrollments: 'sequenceEnrollments',
  sequences: 'sequences',
  sequenceSteps: 'sequenceSteps',
  tasks: 'tasks',
  taskTargets: 'taskTargets',
  timelineActivities: 'timelineActivities',
  workspaceMembers: 'workspaceMembers',
} as const;

export const LINKEDIN_ACTION_TYPES = {
  sendConnectionRequest: 'SEND_CONNECTION_REQUEST',
  sendMessage: 'SEND_MESSAGE',
  withdrawConnectionRequest: 'WITHDRAW_CONNECTION_REQUEST',
} as const;

export const SEQUENCE_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED'] as const;
export const SEQUENCE_ENROLLMENT_STATUSES = [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'REPLIED',
  'FAILED',
  'REMOVED',
] as const;
export const SEQUENCE_STEP_TYPES = [
  'SEND_EMAIL',
  'DELAY',
  'CREATE_TASK',
  'SEND_CONNECTION_REQUEST',
  'SEND_LINKEDIN_MESSAGE',
  'WITHDRAW_CONNECTION_REQUEST',
  'CONDITION',
  'ENRICH_PHONE_NUMBER',
] as const;
export const SEQUENCE_ACTION_EXECUTION_MODES = ['AUTOMATED', 'MANUAL'] as const;
export const SEQUENCE_CONDITION_TYPES = [
  'IS_IN_LINKEDIN_NETWORK',
  'HAS_EMAIL_ADDRESS',
  'HAS_LINKEDIN_URL',
  'ACCEPTED_LINKEDIN_INVITE',
  'OPENED_LINKEDIN_MESSAGE',
  'HAS_PHONE_NUMBER',
] as const;
export const SEQUENCE_CONDITION_BRANCHES = ['YES', 'NO'] as const;
export const SEQUENCE_TASK_TYPES = [
  'CALL',
  'TODO',
  'LINKEDIN_CONNECTION',
  'LINKEDIN_MESSAGE',
  'EMAIL',
  'CUSTOM',
] as const;
export const SEQUENCE_TASK_PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const;
export const SEQUENCE_TASK_CONTINUE_MODES = [
  'IMMEDIATE',
  'ON_DONE',
  'ON_DEADLINE',
] as const;
export const SEQUENCE_WAITING_ON = [
  'DELAY',
  'EMAIL_SCHEDULED',
  'TASK_DONE',
  'TASK_DEADLINE',
  'LINKEDIN_ACTION',
] as const;

export const SEQUENCE_TEMPLATE_VARIABLES = [
  {
    key: 'firstName',
    token: '{{firstName}}',
    description: "Recipient's first name",
  },
  {
    key: 'lastName',
    token: '{{lastName}}',
    description: "Recipient's last name",
  },
  {
    key: 'fullName',
    token: '{{fullName}}',
    description: "Recipient's full name",
  },
  {
    key: 'email',
    token: '{{email}}',
    description: "Recipient's primary email",
  },
  {
    key: 'linkedinUrl',
    token: '{{linkedinUrl}}',
    description: "Recipient's LinkedIn profile URL",
  },
  {
    key: 'jobTitle',
    token: '{{jobTitle}}',
    description: "Recipient's job title",
  },
  {
    key: 'companyName',
    token: '{{companyName}}',
    description: "Recipient's company name",
  },
  {
    key: 'senderName',
    token: '{{senderName}}',
    description: "Sender's display name",
  },
  {
    key: 'senderEmail',
    token: '{{senderEmail}}',
    description: "Sender's email address",
  },
] as const;

export const DEFAULT_SEQUENCE_SETTINGS = {
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: 'UTC',
  dailyStartLimitEnabled: false,
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActionLimitEnabled: false,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 2, 2.5, 3, 3.5, 4, 5],
  stopOnReply: true,
} as const;
