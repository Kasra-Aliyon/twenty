import { type SequenceSettings } from 'twenty-shared/types';

import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import {
  isWithinSendingWindow,
  nextWindowOpen,
  startOfDayInTimezone,
} from 'src/modules/sequence/utils/sequence-window.util';

const buildSettings = (
  overrides: Partial<SequenceSettings> = {},
): SequenceSettings => ({
  ...DEFAULT_SEQUENCE_SETTINGS,
  ...overrides,
});

describe('sequence-window.util', () => {
  describe('isWithinSendingWindow', () => {
    it('uses local wall-clock time across a daylight-saving transition', () => {
      const settings = buildSettings({
        activeDays: [0],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'America/New_York',
      });

      expect(
        isWithinSendingWindow(new Date('2024-03-10T12:59:00.000Z'), settings),
      ).toBe(false);
      expect(
        isWithinSendingWindow(new Date('2024-03-10T13:00:00.000Z'), settings),
      ).toBe(true);
      expect(
        isWithinSendingWindow(new Date('2024-03-10T21:00:00.000Z'), settings),
      ).toBe(true);
      expect(
        isWithinSendingWindow(new Date('2024-03-10T21:01:00.000Z'), settings),
      ).toBe(false);
    });

    it('attributes the after-midnight part of an overnight window to the previous active day', () => {
      const settings = buildSettings({
        activeDays: [1],
        windowStart: '22:00',
        windowEnd: '02:00',
        timezone: 'UTC',
      });

      expect(
        isWithinSendingWindow(new Date('2024-01-01T22:00:00.000Z'), settings),
      ).toBe(true);
      expect(
        isWithinSendingWindow(new Date('2024-01-02T01:30:00.000Z'), settings),
      ).toBe(true);
      expect(
        isWithinSendingWindow(new Date('2024-01-02T02:00:00.000Z'), settings),
      ).toBe(true);
      expect(
        isWithinSendingWindow(new Date('2024-01-02T02:01:00.000Z'), settings),
      ).toBe(false);
    });

    it('rejects an otherwise valid local time on an inactive day', () => {
      const settings = buildSettings({
        activeDays: [1],
        timezone: 'UTC',
      });

      expect(
        isWithinSendingWindow(new Date('2024-01-02T10:00:00.000Z'), settings),
      ).toBe(false);
    });
  });

  describe('startOfDayInTimezone', () => {
    it.each([
      [
        'spring transition',
        '2024-03-10T16:00:00.000Z',
        '2024-03-10T05:00:00.000Z',
      ],
      [
        'fall transition',
        '2024-11-03T17:00:00.000Z',
        '2024-11-03T04:00:00.000Z',
      ],
    ])('finds local midnight on the %s day', (_label, input, expected) => {
      expect(
        startOfDayInTimezone(new Date(input), 'America/New_York').toISOString(),
      ).toBe(expected);
    });
  });

  describe('nextWindowOpen', () => {
    it('returns the same date while already inside the sending window', () => {
      const date = new Date('2024-01-01T10:00:00.000Z');

      expect(nextWindowOpen(date, buildSettings())).toBe(date);
    });

    it('skips inactive days', () => {
      const settings = buildSettings({
        activeDays: [1],
        timezone: 'UTC',
      });

      expect(
        nextWindowOpen(
          new Date('2024-01-02T10:00:00.000Z'),
          settings,
        ).toISOString(),
      ).toBe('2024-01-08T09:00:00.000Z');
    });

    it('uses the destination-day offset when daylight-saving time changes before the next window', () => {
      const settings = buildSettings({
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'America/New_York',
      });

      expect(
        nextWindowOpen(
          new Date('2024-03-08T23:00:00.000Z'),
          settings,
        ).toISOString(),
      ).toBe('2024-03-11T13:00:00.000Z');
    });
  });
});
