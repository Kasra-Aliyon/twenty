import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';

import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { resolveSequenceEmailWindowSettings } from 'src/modules/sequence/utils/resolve-sequence-email-window-settings.util';

const buildSettings = (
  overrides: Partial<SequenceSettings> = {},
): SequenceSettings => ({
  ...DEFAULT_SEQUENCE_SETTINGS,
  ...overrides,
});

describe('resolveSequenceEmailWindowSettings', () => {
  it('keeps the configured sequence timezone in sequence mode', () => {
    const settings = buildSettings({
      sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
      timezone: 'Europe/Helsinki',
    });

    expect(
      resolveSequenceEmailWindowSettings({
        settings,
        recipientTimeZone: 'America/New_York',
      }),
    ).toBe(settings);
  });

  it('uses the dedicated email window in sequence mode', () => {
    const result = resolveSequenceEmailWindowSettings({
      settings: buildSettings({
        windowStart: '09:00',
        windowEnd: '17:00',
        emailWindowStart: '07:30',
        emailWindowEnd: '15:30',
        timezone: 'Europe/Helsinki',
      }),
      recipientTimeZone: 'America/New_York',
    });

    expect(result).toMatchObject({
      windowStart: '07:30',
      windowEnd: '15:30',
      timezone: 'Europe/Helsinki',
    });
  });

  it('uses a valid recipient timezone in recipient mode', () => {
    expect(
      resolveSequenceEmailWindowSettings({
        settings: buildSettings({
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
          timezone: 'Europe/Helsinki',
          emailWindowStart: '08:00',
          emailWindowEnd: '16:00',
        }),
        recipientTimeZone: 'America/New_York',
      }),
    ).toMatchObject({
      windowStart: '08:00',
      windowEnd: '16:00',
      timezone: 'America/New_York',
    });
  });

  it.each([null, undefined, '', 'Not/A_TimeZone'])(
    'falls back to UTC for an unavailable recipient timezone: %p',
    (recipientTimeZone) => {
      expect(
        resolveSequenceEmailWindowSettings({
          settings: buildSettings({
            sendWindowTimezoneMode:
              SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
            timezone: 'Europe/Helsinki',
          }),
          recipientTimeZone,
        }).timezone,
      ).toBe('UTC');
    },
  );
});
