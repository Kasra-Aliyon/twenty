import {
  DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS,
  LINKEDIN_DAILY_READ_LIMIT_MAXIMUM,
  parseLinkedInBrowserSafetySettings,
} from '@/settings/outreach/utils/linkedinBrowserSafetySettings';

describe('parseLinkedInBrowserSafetySettings', () => {
  it('returns defaults for missing or malformed settings', () => {
    expect(parseLinkedInBrowserSafetySettings(null)).toEqual(
      DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS,
    );
    expect(parseLinkedInBrowserSafetySettings('{')).toEqual(
      DEFAULT_LINKEDIN_BROWSER_SAFETY_SETTINGS,
    );
  });

  it('preserves valid settings', () => {
    expect(
      parseLinkedInBrowserSafetySettings(
        JSON.stringify({
          dailyReadLimitEnabled: true,
          dailyReadLimit: 120,
        }),
      ),
    ).toEqual({
      dailyReadLimitEnabled: true,
      dailyReadLimit: 120,
    });
  });

  it('clamps the limit to the supported safety range', () => {
    expect(
      parseLinkedInBrowserSafetySettings(
        JSON.stringify({
          dailyReadLimitEnabled: true,
          dailyReadLimit: LINKEDIN_DAILY_READ_LIMIT_MAXIMUM + 1,
        }),
      ).dailyReadLimit,
    ).toBe(LINKEDIN_DAILY_READ_LIMIT_MAXIMUM);
  });
});
