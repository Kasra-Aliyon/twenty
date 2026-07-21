import { type SequenceSettings } from 'twenty-shared/types';

export const getDefaultSequenceSettings = (): SequenceSettings => ({
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  dailyStarts: 25,
  staggerMinutes: 5,
  stopOnReply: true,
});
