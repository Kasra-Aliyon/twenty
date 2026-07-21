import { type SequenceSettings } from 'twenty-shared/types';

export const getDefaultSequenceSettings = (): SequenceSettings => ({
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 3, 5, 2, 8, 4, 6],
  stopOnReply: true,
});
