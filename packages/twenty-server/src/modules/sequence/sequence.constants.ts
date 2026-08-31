import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  emailWindowStart: '09:00',
  emailWindowEnd: '17:00',
  timezone: 'UTC',
  sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
  senderConnectedAccountIds: [],
  dailyStartLimitEnabled: false,
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActionLimitEnabled: false,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 2, 2.5, 3, 3.5, 4, 5],
  stopOnReply: true,
};

// Direct actions created outside a sequence still share the same LinkedIn
// account and runner. Give them an explicit safety policy so they cannot bypass
// the account-wide pacing chain or daily budget merely because no sequence
// settings snapshot exists.
export const DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS: SequenceSettings = {
  ...DEFAULT_SEQUENCE_SETTINGS,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  windowStart: '00:00',
  windowEnd: '23:59',
  timezone: 'UTC',
  linkedinDailyActionLimitEnabled: true,
};

export const SEQUENCE_SENDER_POOL_MAXIMUM = 20;

export const SEQUENCE_SCHEDULER_BATCH_SIZE = 100;

export const SEQUENCE_PROCESS_JOB_ID_PREFIX = 'sequence-process';
export const SEQUENCE_PROCESS_ENROLLMENT_JOB_NAME =
  'SequenceProcessEnrollmentJob';
export const SEQUENCE_PROCESS_JOB_RETRY_LIMIT = 3;
export const SEQUENCE_PROCESS_JOB_RETRY_BACKOFF_MILLISECONDS = 1_000;
export const SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR = 'Sequence paused';
export const SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR =
  'Sequence pause retry handled';
export const SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR =
  'Sequence enrollment no longer awaits this LinkedIn action';
export const SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT = 3;
export const SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_BASE_MILLISECONDS =
  60 * 1000;

export const SEQUENCE_LAST_SEND_AT_CACHE_KEY_PREFIX = 'sequence:last-send-at';

export const SEQUENCE_LAST_SEND_AT_CACHE_TTL = 2 * 24 * 60 * 60 * 1000;

export const SEQUENCE_MAILBOX_SEND_LOCK_KEY_PREFIX =
  'sequence:mailbox-send-lock';

export const SEQUENCE_MAILBOX_SEND_LOCK_TTL = 10 * 60 * 1000;

export const SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS =
  SEQUENCE_MAILBOX_SEND_LOCK_TTL;

export const SEQUENCE_SEND_ATTEMPT_HEARTBEAT_MILLISECONDS = 60 * 1000;

export const SEQUENCE_EMAIL_PRE_PROVIDER_FAILURE_LIMIT = 5;

// Apollo phone callback tokens are valid for 24 hours. Keep the enrollment
// recoverable slightly longer so an accepted callback can finish committing.
export const SEQUENCE_APOLLO_ENRICHMENT_TIMEOUT_MILLISECONDS =
  24 * 60 * 60 * 1000 + 5 * 60 * 1000;

export const SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS =
  10 * 60 * 1000;

export const SEQUENCE_SEND_SLOT_LOOKAHEAD_MILLISECONDS = 30 * 1000;

export const SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX =
  'sequence:linkedin:last-action-at';

export const SEQUENCE_LINKEDIN_PATTERN_INDEX_CACHE_KEY_PREFIX =
  'sequence:linkedin:pattern-index';

export const SEQUENCE_LINKEDIN_ACTION_LOCK_KEY_PREFIX =
  'sequence:linkedin:action-lock';

export const SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL = 8 * 24 * 60 * 60 * 1000;

export const SEQUENCE_LINKEDIN_ACTION_LOCK_TTL = 30 * 1000;

export const LINKEDIN_ACTION_CLAIM_LEASE_MS = 10 * 60 * 1000;

export const SEQUENCE_LINKEDIN_ACTION_CLAIM_GRACE_MS = 2 * 60 * 1000;

export const LINKEDIN_ACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const LINKEDIN_CONNECTION_OBSERVATION_MAX_AGE_MS = 60 * 60 * 1000;

export const SEQUENCE_LINKEDIN_RECONCILE_GRACE_MS = 2 * 60 * 1000;

export const SEQUENCE_LINKEDIN_INVITATION_CONFIRMATION_WINDOW_MS =
  5 * 60 * 1000;

export const SEQUENCE_TASK_RECONCILE_GRACE_MS = 2 * 60 * 1000;

export const SEQUENCE_METRICS_RECONCILE_GRACE_MS = 5 * 60 * 1000;

export const SEQUENCE_METRICS_RECONCILE_BATCH_SIZE = 20;

export const LINKEDIN_CONNECTION_NOTE_MAX_LENGTH = 200;

export const LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH = 2000;

export const LINKEDIN_DAILY_ACTIONS_MAXIMUM = 40;

export const SEQUENCE_ERROR_MESSAGE_MAX_LENGTH = 1000;

export const SEQUENCE_EXECUTION_ERROR = {
  EMAIL_OPT_OUT: 'EMAIL_OPT_OUT',
  MISSING_EMAIL: 'MISSING_EMAIL',
  MISSING_PERSON: 'MISSING_PERSON',
  MISSING_CONNECTED_ACCOUNT: 'MISSING_CONNECTED_ACCOUNT',
  MISSING_LINKEDIN_URL: 'MISSING_LINKEDIN_URL',
  LINKEDIN_ACTION_EXPIRED: 'LINKEDIN_ACTION_EXPIRED',
  LINKEDIN_ACTION_UNSTARTED: 'LINKEDIN_ACTION_UNSTARTED',
  LINKEDIN_ACTION_UNSTARTED_EXPIRED: 'LINKEDIN_ACTION_UNSTARTED_EXPIRED',
  LINKEDIN_ACTION_OUTCOME_UNKNOWN: 'LINKEDIN_ACTION_OUTCOME_UNKNOWN',
  LINKEDIN_ACTION_MISSING: 'LINKEDIN_ACTION_MISSING',
  SEQUENCE_TASK_MISSING: 'SEQUENCE_TASK_MISSING',
  SEQUENCE_TASK_STEP_MISSING: 'SEQUENCE_TASK_STEP_MISSING',
  LINKEDIN_MESSAGE_EMPTY: 'LINKEDIN_MESSAGE_EMPTY',
  LINKEDIN_MESSAGE_TOO_LONG: 'LINKEDIN_MESSAGE_TOO_LONG',
  LINKEDIN_NOT_CONNECTED: 'LINKEDIN_NOT_CONNECTED',
  APOLLO_ENRICHMENT_DISABLED: 'APOLLO_ENRICHMENT_DISABLED',
  PHONE_ENRICHMENT_NOT_FOUND: 'PHONE_ENRICHMENT_NOT_FOUND',
  SEND_INTERRUPTED: 'SEND_INTERRUPTED',
} as const;

// A sender that is only temporarily unavailable (mailbox mid-sync) is retried
// rather than ending the enrollment. One sync cycle is about a minute.
export const SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS = 5 * 60 * 1000;
