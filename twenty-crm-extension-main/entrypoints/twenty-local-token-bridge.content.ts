import type { ExtensionResponse, TwentyTokenPair } from '../types';

const TOKEN_PAIR_LOCAL_STORAGE_KEY = 'tokenPairState';
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

export default defineContentScript({
  matches: ['http://localhost:3001/*', 'http://127.0.0.1:3001/*'],
  runAt: 'document_idle',

  main() {
    let lastSyncedRawTokenPair: string | null | undefined;

    async function syncTokenPair() {
      const rawTokenPair = localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY);

      if (rawTokenPair === lastSyncedRawTokenPair) {
        return;
      }

      lastSyncedRawTokenPair = rawTokenPair;

      try {
        await browser.runtime.sendMessage({
          type: 'SYNC_TWENTY_TOKEN_PAIR',
          payload: parseTokenPair(rawTokenPair),
        }) as ExtensionResponse;
      } catch (error) {
        console.error('[Twenty Extension] Failed to sync local token pair:', error);
      }
    }

    void syncTokenPair();

    const intervalId = setInterval(() => {
      void syncTokenPair();
    }, SYNC_INTERVAL_MS);

    window.addEventListener('focus', () => {
      void syncTokenPair();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void syncTokenPair();
      }
    });

    window.addEventListener('beforeunload', () => {
      clearInterval(intervalId);
    });
  },
});
