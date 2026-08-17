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

  it('uses a valid recipient timezone in recipient mode', () => {
    expect(
      resolveSequenceEmailWindowSettings({
        settings: buildSettings({
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
          timezone: 'Europe/Helsinki',
        }),
        recipientTimeZone: 'America/New_York',
      }).timezone,
    ).toBe('America/New_York');
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
