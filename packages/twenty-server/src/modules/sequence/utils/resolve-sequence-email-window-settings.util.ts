import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();

    return true;
  } catch {
    return false;
  }
};

export const isRecipientSequenceEmailWindow = (
  settings: SequenceSettings,
): boolean =>
  settings.sendWindowTimezoneMode ===
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT;

export const resolveSequenceEmailWindowSettings = ({
  settings,
  recipientTimeZone,
}: {
  settings: SequenceSettings;
  recipientTimeZone: string | null | undefined;
}): SequenceSettings => {
  const windowStart = settings.emailWindowStart ?? settings.windowStart;
  const windowEnd = settings.emailWindowEnd ?? settings.windowEnd;
  const isRecipientWindow = isRecipientSequenceEmailWindow(settings);

  if (
    !isRecipientWindow &&
    windowStart === settings.windowStart &&
    windowEnd === settings.windowEnd
  ) {
    return settings;
  }

  return {
    ...settings,
    windowStart,
    windowEnd,
    timezone: isRecipientWindow
      ? typeof recipientTimeZone === 'string' &&
        isValidTimeZone(recipientTimeZone)
        ? recipientTimeZone
        : 'UTC'
      : settings.timezone,
  };
};
