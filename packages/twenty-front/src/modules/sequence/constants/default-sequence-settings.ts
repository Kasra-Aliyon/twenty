import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';

export const getDefaultSequenceSettings = (): SequenceSettings => ({
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  emailWindowStart: '09:00',
  emailWindowEnd: '17:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
  dailyStartLimitEnabled: false,
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActionLimitEnabled: false,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 2, 2.5, 3, 3.5, 4, 5],
  stopOnReply: true,
});
