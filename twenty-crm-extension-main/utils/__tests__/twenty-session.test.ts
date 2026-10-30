import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TwentyTokenPair } from '../../types';
import { getTwentyTokenPair, saveTwentyTokenPair } from '../storage';
import {
  syncTwentyBrowserSession,
  withTwentySessionOperation,
} from '../twenty-session';

vi.mock('../storage', () => ({
  getTwentyTokenPair: vi.fn(),
  saveTwentyTokenPair: vi.fn(),
}));

const settings = {
  twentyAppUrl: 'https://crm.example.com',
  twentyApiUrl: 'https://crm.example.com',
};
const identity = {
  sub: 'user-id',
  workspaceId: 'workspace-id',
  authProvider: 'google',
  type: 'ACCESS',
};
const tokenPair = (name: string, claims = identity): TwentyTokenPair => ({
  accessOrWorkspaceAgnosticToken: {
    token: `header.${btoa(JSON.stringify(claims))}.${name}`,
    expiresAt: '2099-01-01T00:00:00Z',
  },
  refreshToken: { token: `${name}-refresh`, expiresAt: '2099-01-01T00:00:00Z' },
});

const browserTokens = tokenPair('browser');
const extensionTokens = tokenPair('extension');
const mockFetch = vi.fn<typeof fetch>();

const mockSessionCreation = (tokens = extensionTokens) => {
  mockFetch.mockResolvedValueOnce(
    Response.json({
      data: {
        currentUser: {
          availableWorkspaces: {
            availableWorkspacesForSignIn: [
              {
                id: identity.workspaceId,
                loginToken: 'independent-login-token',
              },
            ],
          },
        },
      },
    }),
  );
  mockFetch.mockResolvedValueOnce(
    Response.json({
      data: { getAuthTokensFromLoginToken: { tokens } },
    }),
  );
};

describe('independent extension login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.mocked(getTwentyTokenPair).mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('should create an independent session without rotating the browser refresh token', async () => {
    mockSessionCreation();

    await syncTwentyBrowserSession(settings, browserTokens);

    expect(saveTwentyTokenPair).toHaveBeenLastCalledWith({
      ...extensionTokens,
      sessionSource: 'extension',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const requests = mockFetch.mock.calls.map(([, options]) =>
      JSON.parse(options!.body as string),
    );
    expect(requests[0].query).toContain('currentUser');
    expect(requests[1].variables).toEqual({
      loginToken: 'independent-login-token',
      origin: settings.twentyAppUrl,
    });
    expect(JSON.stringify(requests)).not.toContain(
      browserTokens.refreshToken.token,
    );
    expect(JSON.stringify(requests)).not.toContain('renewToken');
  });

  it('should keep the extension session when the same browser session rotates', async () => {
    vi.mocked(getTwentyTokenPair).mockResolvedValue({
      ...extensionTokens,
      sessionSource: 'extension',
    });

    await syncTwentyBrowserSession(settings, tokenPair('new-browser'));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(saveTwentyTokenPair).not.toHaveBeenCalled();
  });

  it('should replace a legacy shared session before the extension can renew it', async () => {
    vi.mocked(getTwentyTokenPair).mockResolvedValue(browserTokens);
    mockSessionCreation();

    await syncTwentyBrowserSession(settings, browserTokens);

    expect(saveTwentyTokenPair).toHaveBeenLastCalledWith({
      ...extensionTokens,
      sessionSource: 'extension',
    });
  });

  it('should clear credentials on browser sign-out', async () => {
    vi.mocked(getTwentyTokenPair).mockResolvedValue({
      ...extensionTokens,
      sessionSource: 'extension',
    });

    await syncTwentyBrowserSession(settings, null);

    expect(saveTwentyTokenPair).toHaveBeenCalledWith(null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should discard a different user session before attempting a new login', async () => {
    vi.mocked(getTwentyTokenPair).mockResolvedValue({
      ...tokenPair('other-user', { ...identity, sub: 'other-user' }),
      sessionSource: 'extension',
    });
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      syncTwentyBrowserSession(settings, browserTokens),
    ).rejects.toThrow();

    expect(saveTwentyTokenPair).toHaveBeenCalledExactlyOnceWith(null);
  });

  it.each([
    tokenPair('wrong-user', { ...identity, sub: 'other-user' }),
    tokenPair('wrong-workspace', {
      ...identity,
      workspaceId: 'other-workspace',
    }),
    tokenPair('wrong-provider', { ...identity, authProvider: 'password' }),
    browserTokens,
  ])(
    'should reject a session for a different identity or a shared refresh token',
    async (tokens) => {
      mockSessionCreation(tokens);

      await expect(
        syncTwentyBrowserSession(settings, browserTokens),
      ).rejects.toThrow('independent extension session');
      expect(saveTwentyTokenPair).not.toHaveBeenCalledWith(
        expect.objectContaining({ sessionSource: 'extension' }),
      );
    },
  );

  it('should not create a session while impersonating another user', async () => {
    const impersonationTokens = tokenPair('impersonation', {
      ...identity,
      isImpersonating: true,
    } as typeof identity);

    await syncTwentyBrowserSession(settings, impersonationTokens);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should serialize token synchronization behind in-flight renewal', async () => {
    const calls: string[] = [];
    let finishRenewal: (() => void) | undefined;
    const renewal = withTwentySessionOperation(async () => {
      await new Promise<void>((resolve) => {
        finishRenewal = resolve;
      });
      calls.push('renewal');
    });
    const synchronization = withTwentySessionOperation(async () => {
      calls.push('sync');
    });
    await Promise.resolve();
    expect(calls).toEqual([]);
    finishRenewal!();
    await Promise.all([renewal, synchronization]);
    expect(calls).toEqual(['renewal', 'sync']);
  });
});
