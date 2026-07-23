export const SERVER_NAME = 'twenty-mcp-server';
export const SERVER_VERSION = '0.1.0';

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
  linkedinActions: 'linkedinActions',
  linkedinConnections: 'linkedinConnections',
  linkedinInvitations: 'linkedinInvitations',
  linkedinMessages: 'linkedinMessages',
  linkedinMessageThreads: 'linkedinMessageThreads',
  linkedinThreadParticipants: 'linkedinThreadParticipants',
  messageThreads: 'messageThreads',
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
] as const;

export const DEFAULT_SEQUENCE_SETTINGS = {
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: 'UTC',
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [15, 22, 35, 18, 28, 45, 20],
  stopOnReply: true,
} as const;
