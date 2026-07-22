import { type SequenceSettings } from 'twenty-shared/types';

import {
  DEFAULT_SEQUENCE_SETTINGS,
  LINKEDIN_DAILY_ACTIONS_MAXIMUM,
} from 'src/modules/sequence/sequence.constants';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();

    return true;
  } catch {
    return false;
  }
};

const toNonNegativeNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;

const toPositiveNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;

export const parseSequenceSettings = (value: unknown): SequenceSettings => {
  if (!isRecord(value)) {
    return { ...DEFAULT_SEQUENCE_SETTINGS };
  }

  const activeDays = Array.isArray(value.activeDays)
    ? [
        ...new Set(
          value.activeDays.filter(
            (day): day is number =>
              typeof day === 'number' &&
              Number.isInteger(day) &&
              day >= 0 &&
              day <= 6,
          ),
        ),
      ]
    : DEFAULT_SEQUENCE_SETTINGS.activeDays;
  const windowStart =
    typeof value.windowStart === 'string' &&
    TIME_PATTERN.test(value.windowStart)
      ? value.windowStart
      : DEFAULT_SEQUENCE_SETTINGS.windowStart;
  const windowEnd =
    typeof value.windowEnd === 'string' && TIME_PATTERN.test(value.windowEnd)
      ? value.windowEnd
      : DEFAULT_SEQUENCE_SETTINGS.windowEnd;
  const timezone =
    typeof value.timezone === 'string' && isValidTimeZone(value.timezone)
      ? value.timezone
      : DEFAULT_SEQUENCE_SETTINGS.timezone;

  return {
    activeDays,
    windowStart,
    windowEnd,
    timezone,
    dailyStarts: Math.floor(
      toNonNegativeNumber(
        value.dailyStarts,
        DEFAULT_SEQUENCE_SETTINGS.dailyStarts,
      ),
    ),
    staggerMinutes: toNonNegativeNumber(
      value.staggerMinutes,
      DEFAULT_SEQUENCE_SETTINGS.staggerMinutes,
    ),
    linkedinDailyActions: Math.min(
      LINKEDIN_DAILY_ACTIONS_MAXIMUM,
      Math.max(
        1,
        Math.floor(
          toPositiveNumber(
            value.linkedinDailyActions,
            DEFAULT_SEQUENCE_SETTINGS.linkedinDailyActions,
          ),
        ),
      ),
    ),
    linkedinDelayPatternMinutes:
      Array.isArray(value.linkedinDelayPatternMinutes) &&
      value.linkedinDelayPatternMinutes.length > 0 &&
      value.linkedinDelayPatternMinutes.every(
        (delay) =>
          typeof delay === 'number' && Number.isFinite(delay) && delay > 0,
      )
        ? value.linkedinDelayPatternMinutes
        : DEFAULT_SEQUENCE_SETTINGS.linkedinDelayPatternMinutes,
    stopOnReply:
      typeof value.stopOnReply === 'boolean'
        ? value.stopOnReply
        : DEFAULT_SEQUENCE_SETTINGS.stopOnReply,
  };
};
