import type {
  ExtensionResponse,
  LinkedInSafetySettings,
  TwentyTokenPair,
} from '../types';

const TOKEN_PAIR_LOCAL_STORAGE_KEY = 'tokenPairState';
const LINKEDIN_SAFETY_SETTINGS_LOCAL_STORAGE_KEY =
  'twentyLinkedinSafetySettings';
const SYNC_INTERVAL_MS = 5000;

function parseTokenPair(rawTokenPair: string | null): TwentyTokenPair | null {
  if (!rawTokenPair) {
    return null;
  }

  try {
    const tokenPair = JSON.parse(rawTokenPair) as Partial<TwentyTokenPair>;

    if (
      typeof tokenPair.accessOrWorkspaceAgnosticToken?.token !== 'string' ||
      tokenPair.accessOrWorkspaceAgnosticToken.token.length === 0
    ) {
      return null;
    }

    return tokenPair as TwentyTokenPair;
  } catch {
    return null;
  }
}

function parseLinkedInSafetySettings(
  rawSettings: string | null,
): Partial<LinkedInSafetySettings> | null {
  if (!rawSettings) {
    return null;
  }

  try {
    const settings = JSON.parse(rawSettings) as Partial<LinkedInSafetySettings>;

    if (
      typeof settings.dailyReadLimitEnabled !== 'boolean' ||
      typeof settings.dailyReadLimit !== 'number' ||
      !Number.isInteger(settings.dailyReadLimit)
    ) {
      return null;
    }

    return settings;
  } catch {
    return null;
  }
}

export default defineContentScript({
  matches: [
    'http://localhost:2001/*',
    'http://127.0.0.1:2001/*',
    'http://localhost:3001/*',
    'http://127.0.0.1:3001/*',
  ],
  runAt: 'document_idle',

  main() {
    let lastSyncedRawTokenPair: string | null | undefined;
    let lastSyncedRawLinkedInSafetySettings: string | null | undefined;

    async function syncTokenPair() {
      const rawTokenPair = localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY);

      if (rawTokenPair === lastSyncedRawTokenPair) {
        return;
      }

      lastSyncedRawTokenPair = rawTokenPair;

      try {
        (await browser.runtime.sendMessage({
          type: 'SYNC_TWENTY_TOKEN_PAIR',
          payload: parseTokenPair(rawTokenPair),
        })) as ExtensionResponse;
      } catch (error) {
        console.error(
          '[Twenty Extension] Failed to sync local token pair:',
          error,
        );
      }
    }

    async function syncLinkedInSafetySettings() {
      const rawSettings = localStorage.getItem(
        LINKEDIN_SAFETY_SETTINGS_LOCAL_STORAGE_KEY,
      );

      if (rawSettings === lastSyncedRawLinkedInSafetySettings) {
        return;
      }

      lastSyncedRawLinkedInSafetySettings = rawSettings;
      const settings = parseLinkedInSafetySettings(rawSettings);

      if (!settings) {
        return;
      }

      try {
        (await browser.runtime.sendMessage({
          type: 'SYNC_LINKEDIN_SAFETY_SETTINGS',
          payload: settings,
        })) as ExtensionResponse;
      } catch (error) {
        console.error(
          '[Twenty Extension] Failed to sync LinkedIn safety settings:',
          error,
        );
      }
    }

    void Promise.all([syncTokenPair(), syncLinkedInSafetySettings()]);

    const intervalId = setInterval(() => {
      void Promise.all([syncTokenPair(), syncLinkedInSafetySettings()]);
    }, SYNC_INTERVAL_MS);

    window.addEventListener('focus', () => {
      void Promise.all([syncTokenPair(), syncLinkedInSafetySettings()]);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void Promise.all([syncTokenPair(), syncLinkedInSafetySettings()]);
      }
    });

    window.addEventListener('beforeunload', () => {
      clearInterval(intervalId);
    });
  },
});
