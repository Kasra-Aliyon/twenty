export const LINKEDIN_BROWSER_SAFETY_SETTINGS_LOCAL_STORAGE_KEY =
  'twentyLinkedinSafetySettings';

export const LINKEDIN_DAILY_READ_LIMIT_DEFAULT = 200;
export const LINKEDIN_DAILY_READ_LIMIT_MINIMUM = 1;
export const LINKEDIN_DAILY_READ_LIMIT_MAXIMUM = 200;

export type LinkedInBrowserSafetySettings = {
  dailyReadLimitEnabled: boolean;
  dailyReadLimit: number;
};

export const DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS: LinkedInBrowserSafetySettings =
  {
    dailyReadLimitEnabled: false,
    dailyReadLimit: LINKEDIN_DAILY_READ_LIMIT_DEFAULT,
  };

const normalizeDailyReadLimit = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value)
    ? Math.min(
        LINKEDIN_DAILY_READ_LIMIT_MAXIMUM,
        Math.max(LINKEDIN_DAILY_READ_LIMIT_MINIMUM, value),
      )
    : LINKEDIN_DAILY_READ_LIMIT_DEFAULT;

export const parseLinkedInBrowserSafetySettings = (
  rawSettings: string | null,
): LinkedInBrowserSafetySettings => {
  if (!rawSettings) {
    return { ...DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS };
  }

  try {
    const settings = JSON.parse(
      rawSettings,
    ) as Partial<LinkedInBrowserSafetySettings>;

    return {
      dailyReadLimitEnabled:
        typeof settings.dailyReadLimitEnabled === 'boolean'
          ? settings.dailyReadLimitEnabled
          : DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS.dailyReadLimitEnabled,
      dailyReadLimit: normalizeDailyReadLimit(settings.dailyReadLimit),
    };
  } catch {
    return { ...DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS };
  }
};

export const readLinkedInBrowserSafetySettings =
  (): LinkedInBrowserSafetySettings =>
    parseLinkedInBrowserSafetySettings(
      window.localStorage.getItem(
        LINKEDIN_BROWSER_SAFETY_SETTINGS_LOCAL_STORAGE_KEY,
      ),
    );

export const saveLinkedInBrowserSafetySettings = (
  settings: LinkedInBrowserSafetySettings,
): LinkedInBrowserSafetySettings => {
  const normalizedSettings = parseLinkedInBrowserSafetySettings(
    JSON.stringify(settings),
  );

  window.localStorage.setItem(
    LINKEDIN_BROWSER_SAFETY_SETTINGS_LOCAL_STORAGE_KEY,
    JSON.stringify(normalizedSettings),
  );

  return normalizedSettings;
};
