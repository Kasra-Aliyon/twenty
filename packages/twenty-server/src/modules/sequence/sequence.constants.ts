import { type SequenceSettings } from 'twenty-shared/types';

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: 'UTC',
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [15, 22, 35, 18, 28, 45, 20],
  stopOnReply: true,
};

export const SEQUENCE_SCHEDULER_BATCH_SIZE = 100;

export const SEQUENCE_PROCESS_JOB_ID_PREFIX = 'sequence-process';

export const SEQUENCE_LAST_SEND_AT_CACHE_KEY_PREFIX = 'sequence:last-send-at';

export const SEQUENCE_LAST_SEND_AT_CACHE_TTL = 2 * 24 * 60 * 60 * 1000;

export const SEQUENCE_MAILBOX_SEND_LOCK_KEY_PREFIX =
  'sequence:mailbox-send-lock';

export const SEQUENCE_MAILBOX_SEND_LOCK_TTL = 10 * 60 * 1000;

export const SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS =
  SEQUENCE_MAILBOX_SEND_LOCK_TTL;

export const SEQUENCE_SEND_SLOT_LOOKAHEAD_MILLISECONDS = 30 * 1000;

export const SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX =
  'sequence:linkedin:last-action-at';

export const SEQUENCE_LINKEDIN_PATTERN_INDEX_CACHE_KEY_PREFIX =
  'sequence:linkedin:pattern-index';

export const SEQUENCE_LINKEDIN_DAILY_COUNT_CACHE_KEY_PREFIX =
  'sequence:linkedin:daily-count';

export const SEQUENCE_LINKEDIN_ACTION_LOCK_KEY_PREFIX =
  'sequence:linkedin:action-lock';

export const SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL = 8 * 24 * 60 * 60 * 1000;

export const SEQUENCE_LINKEDIN_ACTION_LOCK_TTL = 30 * 1000;

export const LINKEDIN_ACTION_CLAIM_LEASE_MS = 10 * 60 * 1000;

export const LINKEDIN_ACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const LINKEDIN_CONNECTION_NOTE_MAX_LENGTH = 200;

export const LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH = 2000;

export const LINKEDIN_DAILY_ACTIONS_MAXIMUM = 20;

export const SEQUENCE_ERROR_MESSAGE_MAX_LENGTH = 1000;

export const SEQUENCE_EXECUTION_ERROR = {
  EMAIL_OPT_OUT: 'EMAIL_OPT_OUT',
  MISSING_EMAIL: 'MISSING_EMAIL',
  MISSING_PERSON: 'MISSING_PERSON',
  MISSING_CONNECTED_ACCOUNT: 'MISSING_CONNECTED_ACCOUNT',
  MISSING_LINKEDIN_URL: 'MISSING_LINKEDIN_URL',
  LINKEDIN_ACTION_EXPIRED: 'LINKEDIN_ACTION_EXPIRED',
  LINKEDIN_MESSAGE_EMPTY: 'LINKEDIN_MESSAGE_EMPTY',
  LINKEDIN_MESSAGE_TOO_LONG: 'LINKEDIN_MESSAGE_TOO_LONG',
  INVALID_STEP_SETTINGS: 'INVALID_STEP_SETTINGS',
  SEND_INTERRUPTED: 'SEND_INTERRUPTED',
} as const;
