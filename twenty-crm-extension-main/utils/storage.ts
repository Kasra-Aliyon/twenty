import { storage } from '#imports';
import type { ExtensionSettings, TwentyTokenPair } from '../types';

export const DEFAULT_TWENTY_APP_URL = 'http://localhost:2001';
export const DEFAULT_TWENTY_API_URL = 'http://localhost:2000';
const LEGACY_DEFAULT_TWENTY_APP_URL = 'http://localhost:3001';
const LEGACY_DEFAULT_TWENTY_API_URL = 'http://localhost:3000';

// Define storage items with proper typing
export const legacyTwentyUrlStorage = storage.defineItem<string>(
  'sync:twentyUrl',
  {
    fallback: '',
  },
);

export const twentyAppUrlStorage = storage.defineItem<string>(
  'sync:twentyAppUrl',
  {
    fallback: DEFAULT_TWENTY_APP_URL,
  },
);

export const twentyApiUrlStorage = storage.defineItem<string>(
  'sync:twentyApiUrl',
  {
    fallback: DEFAULT_TWENTY_API_URL,
  },
);

export const twentyTokenPairStorage =
  storage.defineItem<TwentyTokenPair | null>('local:twentyTokenPair', {
    fallback: null,
  });

export const lastCapturedStorage = storage.defineItem<
  Array<{
    linkedinUrl: string;
    name: string;
    type: 'person' | 'company';
    capturedAt: number;
    twentyId: string;
  }>
>('local:lastCaptured', {
  fallback: [],
});

// Helper functions
export async function getSettings(): Promise<ExtensionSettings> {
  const legacyTwentyUrl = await legacyTwentyUrlStorage.getValue();
  let twentyAppUrl = await twentyAppUrlStorage.getValue();
  let twentyApiUrl = await twentyApiUrlStorage.getValue();

  const settingsUpdates: Promise<void>[] = [];

  if (twentyAppUrl === LEGACY_DEFAULT_TWENTY_APP_URL) {
    twentyAppUrl = DEFAULT_TWENTY_APP_URL;
    settingsUpdates.push(twentyAppUrlStorage.setValue(twentyAppUrl));
  }

  if (twentyApiUrl === LEGACY_DEFAULT_TWENTY_API_URL) {
    twentyApiUrl = DEFAULT_TWENTY_API_URL;
    settingsUpdates.push(twentyApiUrlStorage.setValue(twentyApiUrl));
  }

  if (settingsUpdates.length > 0) {
    await Promise.all(settingsUpdates);
  }

  return {
    twentyAppUrl: twentyAppUrl || legacyTwentyUrl || DEFAULT_TWENTY_APP_URL,
    twentyApiUrl: twentyApiUrl || legacyTwentyUrl || DEFAULT_TWENTY_API_URL,
  };
}

export async function saveSettings(
  settings: Partial<ExtensionSettings>,
): Promise<void> {
  if (settings.twentyAppUrl !== undefined) {
    await twentyAppUrlStorage.setValue(settings.twentyAppUrl);
  }

  if (settings.twentyApiUrl !== undefined) {
    await twentyApiUrlStorage.setValue(settings.twentyApiUrl);
  }
}

export async function saveTwentyTokenPair(
  tokenPair: TwentyTokenPair | null,
): Promise<void> {
  await twentyTokenPairStorage.setValue(tokenPair);
}

export async function getTwentyTokenPair(): Promise<TwentyTokenPair | null> {
  return twentyTokenPairStorage.getValue();
}

export async function addToRecentCaptures(capture: {
  linkedinUrl: string;
  name: string;
  type: 'person' | 'company';
  twentyId: string;
}): Promise<void> {
  const current = await lastCapturedStorage.getValue();
  const newCapture = {
    ...capture,
    capturedAt: Date.now(),
  };

  // Keep only last 10 captures, remove duplicates
  const filtered = current.filter((c) => c.linkedinUrl !== capture.linkedinUrl);
  const updated = [newCapture, ...filtered].slice(0, 10);

  await lastCapturedStorage.setValue(updated);
}

export async function getRecentCaptures() {
  return lastCapturedStorage.getValue();
}
