import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';

describe('parseSequenceSettings', () => {
  it.each([undefined, null, 'settings', 42, [], true])(
    'returns defaults for a non-record value: %p',
    (value) => {
      expect(parseSequenceSettings(value)).toEqual(DEFAULT_SEQUENCE_SETTINGS);
    },
  );

  it('uses defaults for absent settings', () => {
    expect(parseSequenceSettings({})).toEqual(DEFAULT_SEQUENCE_SETTINGS);
  });

  it('normalizes valid custom settings', () => {
    expect(
      parseSequenceSettings({
        activeDays: [5, 1, 5, 0],
        windowStart: '23:59',
        windowEnd: '00:00',
        timezone: 'Europe/Helsinki',
        dailyStarts: 12.9,
        staggerMinutes: 0.5,
        stopOnReply: false,
      }),
    ).toEqual({
      activeDays: [5, 1, 0],
      windowStart: '23:59',
      windowEnd: '00:00',
      timezone: 'Europe/Helsinki',
      dailyStarts: 12,
      staggerMinutes: 0.5,
      stopOnReply: false,
    });
  });

  it('falls back field-by-field for invalid settings', () => {
    expect(
      parseSequenceSettings({
        activeDays: 'weekdays',
        windowStart: '24:00',
        windowEnd: '09:60',
        timezone: 'Not/A_Timezone',
        dailyStarts: -1,
        staggerMinutes: Number.NaN,
        stopOnReply: 'true',
      }),
    ).toEqual(DEFAULT_SEQUENCE_SETTINGS);
  });

  it('filters invalid active days and accepts an intentionally empty schedule', () => {
    expect(
      parseSequenceSettings({
        activeDays: [-1, 0, 2.5, 6, 7, '2'],
      }).activeDays,
    ).toEqual([0, 6]);
    expect(parseSequenceSettings({ activeDays: [] }).activeDays).toEqual([]);
  });

  it('rejects non-finite and non-number pacing values', () => {
    expect(
      parseSequenceSettings({
        dailyStarts: Number.POSITIVE_INFINITY,
        staggerMinutes: '5',
      }),
    ).toMatchObject({
      dailyStarts: DEFAULT_SEQUENCE_SETTINGS.dailyStarts,
      staggerMinutes: DEFAULT_SEQUENCE_SETTINGS.staggerMinutes,
    });
  });
});
