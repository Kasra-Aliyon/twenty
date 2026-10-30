// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest';

it('should avoid duplicate sync requests and retry the latest browser session after failure', async () => {
  vi.useFakeTimers();
  let startBridge: (() => void) | undefined;
  let resolveSync: ((response: { success: boolean }) => void) | undefined;
  const sendMessage = vi.fn(
    () =>
      new Promise<{ success: boolean }>((resolve) => {
        resolveSync = resolve;
      }),
  );

  vi.stubGlobal('defineContentScript', (definition: { main: () => void }) => {
    startBridge = definition.main;
    return definition;
  });
  vi.stubGlobal('browser', { runtime: { sendMessage } });

  const originalTokens = {
    accessOrWorkspaceAgnosticToken: { token: 'original-browser-access' },
  };
  const latestTokens = {
    accessOrWorkspaceAgnosticToken: { token: 'latest-browser-access' },
  };
  localStorage.setItem('tokenPairState', JSON.stringify(originalTokens));

  await import('../../entrypoints/twenty-local-token-bridge.content');
  startBridge!();
  expect(sendMessage).toHaveBeenCalledTimes(1);

  localStorage.setItem('tokenPairState', JSON.stringify(latestTokens));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(sendMessage).toHaveBeenCalledTimes(1);

  resolveSync!({ success: false });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'SYNC_TWENTY_TOKEN_PAIR',
    payload: latestTokens,
  });

  resolveSync!({ success: true });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});
