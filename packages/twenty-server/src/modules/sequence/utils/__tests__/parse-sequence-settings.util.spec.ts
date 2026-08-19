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
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        senderConnectedAccountIds: [
          'connected-account-2',
          'connected-account-1',
          'connected-account-2',
          '',
        ],
        dailyStartLimitEnabled: true,
        dailyStarts: 12.9,
        staggerMinutes: 0.5,
        linkedinDailyActionLimitEnabled: true,
        linkedinDailyActions: 15.9,
        linkedinDelayPatternMinutes: [2, 4, 1.5],
        stopOnReply: false,
      }),
    ).toEqual({
      activeDays: [5, 1, 0],
      windowStart: '23:59',
      windowEnd: '00:00',
      timezone: 'Europe/Helsinki',
      sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      senderConnectedAccountIds: ['connected-account-2', 'connected-account-1'],
      dailyStartLimitEnabled: true,
      dailyStarts: 12,
      staggerMinutes: 0.5,
      linkedinDailyActionLimitEnabled: true,
      linkedinDailyActions: 15,
      linkedinDelayPatternMinutes: [2, 4, 1.5],
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
        sendWindowTimezoneMode: 'LOCAL',
        dailyStartLimitEnabled: 'true',
        dailyStarts: -1,
        staggerMinutes: Number.NaN,
        linkedinDailyActionLimitEnabled: 'true',
        linkedinDailyActions: 0,
        linkedinDelayPatternMinutes: [1, -2],
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

    expect(
      parseSequenceSettings({ linkedinDailyActions: 0.5 }).linkedinDailyActions,
    ).toBe(1);
  });

  it('clamps a zero daily-start limit so an active sequence can admit work', () => {
    expect(
      parseSequenceSettings({
        ...DEFAULT_SEQUENCE_SETTINGS,
        dailyStartLimitEnabled: true,
        dailyStarts: 0,
      }).dailyStarts,
    ).toBe(1);
  });

  it('caps the configurable LinkedIn daily limit at 40', () => {
    expect(
      parseSequenceSettings({ linkedinDailyActions: 50 }).linkedinDailyActions,
    ).toBe(40);
  });

  it('caps the sender pool at 20 connected accounts', () => {
    const senderConnectedAccountIds = Array.from(
      { length: 25 },
      (_, index) => `connected-account-${index}`,
    );

    expect(
      parseSequenceSettings({ senderConnectedAccountIds })
        .senderConnectedAccountIds,
    ).toEqual(senderConnectedAccountIds.slice(0, 20));
  });
});
import { SEQUENCE_SEND_WINDOW_TIMEZONE_MODES } from 'twenty-shared/types';
