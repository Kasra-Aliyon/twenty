import type {
  ExtensionSettings,
  GraphQLResponse,
  TwentyTokenPair,
} from '../types';
import {
  getSettings,
  getTwentyTokenPair,
  saveTwentyTokenPair,
} from './storage';

type SessionIdentity = {
  sub: string;
  workspaceId: string;
  authProvider: string;
};

let sessionOperation: Promise<unknown> = Promise.resolve();

const RENEW_TOKEN_MUTATION = `
  mutation RenewToken($appToken: String!) {
    renewToken(appToken: $appToken) {
      tokens {
        accessOrWorkspaceAgnosticToken { token expiresAt }
        refreshToken { token expiresAt }
      }
    }
  }
`;

type RenewTokenResult = { renewToken?: { tokens?: TwentyTokenPair } };

export const TWENTY_SIGN_IN_REQUIRED =
  'Open Twenty CRM and sign in, then click Sync now again.';
const TWENTY_SESSION_UNAVAILABLE =
  'Could not reach Twenty CRM to renew the session. Try again shortly.';

class SessionRequestError extends Error {
  constructor(readonly retryable: boolean) {
    super(retryable ? TWENTY_SESSION_UNAVAILABLE : TWENTY_SIGN_IN_REQUIRED);
  }
}

export const withTwentySessionOperation = <TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const result = sessionOperation.then(operation, operation);
  sessionOperation = result.catch(() => undefined);
  return result;
};

const decodeToken = (token: string): Record<string, unknown> => {
  try {
    const encoded = token.split('.')[1];
    const payload: unknown = JSON.parse(
      atob(encoded.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const getUsableToken = (
  credential: TwentyTokenPair['refreshToken'] | undefined,
  minimumLifetime = 0,
): string | null => {
  if (!credential?.token) return null;

  const payload = decodeToken(credential.token);
  const expiresAt = Math.min(
    Date.parse(credential.expiresAt) || Infinity,
    typeof payload.exp === 'number' ? payload.exp * 1_000 : Infinity,
  );

  return expiresAt <= Date.now() + minimumLifetime ? null : credential.token;
};

const getSessionIdentity = (
  tokenPair: Pick<TwentyTokenPair, 'accessOrWorkspaceAgnosticToken'> | null,
): SessionIdentity | null => {
  const payload = decodeToken(
    tokenPair?.accessOrWorkspaceAgnosticToken?.token ?? '',
  );
  if (
    payload.type !== 'ACCESS' ||
    payload.isImpersonating === true ||
    typeof payload.sub !== 'string' ||
    typeof payload.workspaceId !== 'string' ||
    typeof payload.authProvider !== 'string'
  )
    return null;

  return {
    sub: payload.sub,
    workspaceId: payload.workspaceId,
    authProvider: payload.authProvider,
  };
};

const haveSameIdentity = (
  first: SessionIdentity | null,
  second: SessionIdentity | null,
): boolean =>
  first !== null &&
  second !== null &&
  first.sub === second.sub &&
  first.workspaceId === second.workspaceId &&
  first.authProvider === second.authProvider;

const requestMetadata = async <TData>(
  settings: ExtensionSettings,
  accessToken: string | null,
  query: string,
  variables?: Record<string, string>,
): Promise<TData> => {
  try {
    const response = await fetch(`${settings.twentyApiUrl}/metadata`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new SessionRequestError(![400, 401, 403].includes(response.status));
    }

    const result = (await response.json()) as GraphQLResponse<TData>;
    if (result.errors?.length) {
      throw new SessionRequestError(
        !result.errors.some(
          (error) =>
            ['UNAUTHENTICATED', 'FORBIDDEN', 'BAD_USER_INPUT'].includes(
              error.extensions?.code ?? '',
            ) ||
            /^Token has expired\.|^This refresh token (has been revoked|doesn't exist)/.test(
              error.message,
            ),
        ),
      );
    }
    if (!result.data) throw new SessionRequestError(true);
    return result.data;
  } catch (error) {
    if (error instanceof SessionRequestError) throw error;
    throw new SessionRequestError(true);
  }
};

// The extension needs its own refresh token. Rotating a copied browser token
// revokes the browser's saved login while its tab is closed or asleep.
export const syncTwentyBrowserSession = async (
  settings: ExtensionSettings,
  browserTokens: TwentyTokenPair | null,
): Promise<void> => {
  const browserIdentity = getSessionIdentity(browserTokens);
  const currentTokens = await getTwentyTokenPair();
  const currentIdentity = getSessionIdentity(currentTokens);
  const isSameIdentity = haveSameIdentity(browserIdentity, currentIdentity);

  if (!isSameIdentity) await saveTwentyTokenPair(null);
  if (!browserTokens || !browserIdentity) return;

  if (
    isSameIdentity &&
    currentTokens?.sessionSource === 'extension' &&
    getUsableToken(currentTokens.refreshToken)
  )
    return;

  await createTwentyExtensionSession(settings, browserTokens, browserIdentity);
};

const createTwentyExtensionSession = async (
  settings: ExtensionSettings,
  browserTokens: TwentyTokenPair,
  browserIdentity: SessionIdentity,
): Promise<string> => {
  const accessToken = getUsableToken(
    browserTokens.accessOrWorkspaceAgnosticToken,
  );
  if (!accessToken) throw new SessionRequestError(false);

  const workspaces = await requestMetadata<{
    currentUser: {
      availableWorkspaces: {
        availableWorkspacesForSignIn: {
          id: string;
          loginToken?: string | null;
        }[];
      };
    };
  }>(
    settings,
    accessToken,
    `
    query ExtensionSessionWorkspace {
      currentUser {
        availableWorkspaces {
          availableWorkspacesForSignIn { id loginToken }
        }
      }
    }
  `,
  );

  const workspace =
    workspaces.currentUser.availableWorkspaces.availableWorkspacesForSignIn.find(
      ({ id }) => id === browserIdentity.workspaceId,
    );
  if (!workspace?.loginToken) throw new SessionRequestError(false);

  const result = await requestMetadata<{
    getAuthTokensFromLoginToken: { tokens: TwentyTokenPair };
  }>(
    settings,
    accessToken,
    `
    mutation ExtensionSession($loginToken: String!, $origin: String!) {
      getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
        tokens {
          accessOrWorkspaceAgnosticToken { token expiresAt }
          refreshToken { token expiresAt }
        }
      }
    }
  `,
    {
      loginToken: workspace.loginToken,
      origin: new URL(settings.twentyAppUrl).origin,
    },
  );

  const tokens = result.getAuthTokensFromLoginToken?.tokens;
  const extensionAccessToken = getUsableToken(
    tokens?.accessOrWorkspaceAgnosticToken,
  );
  if (
    !tokens ||
    !extensionAccessToken ||
    !haveSameIdentity(browserIdentity, getSessionIdentity(tokens)) ||
    !getUsableToken(tokens.refreshToken) ||
    tokens.refreshToken.token === browserTokens.refreshToken?.token
  )
    throw new Error('CRM did not return an independent extension session');

  await saveTwentyTokenPair({ ...tokens, sessionSource: 'extension' });
  return extensionAccessToken;
};

const renewExtensionSession = async (
  settings: ExtensionSettings,
  refreshToken: string,
): Promise<TwentyTokenPair | undefined> => {
  const renew = () =>
    requestMetadata<RenewTokenResult>(settings, null, RENEW_TOKEN_MUTATION, {
      appToken: refreshToken,
    });
  const result = await renew().catch((error: unknown) => {
    if (!(error instanceof SessionRequestError) || !error.retryable)
      throw error;

    // Twenty accepts a recently rotated token during the reuse grace period.
    return renew();
  });

  return result.renewToken?.tokens;
};

export const getTwentyAccessToken = (
  settings: ExtensionSettings,
  readBrowserSession: () => Promise<TwentyTokenPair | null>,
  rejectedAccessToken?: string,
): Promise<string | null> =>
  withTwentySessionOperation(async () => {
    const currentSettings = await getSettings();
    if (
      settings.twentyApiUrl !== currentSettings.twentyApiUrl ||
      settings.twentyAppUrl !== currentSettings.twentyAppUrl
    ) {
      throw new Error('The selected Twenty CRM changed. Try again.');
    }

    const stored = await getTwentyTokenPair();
    const storedIdentity = getSessionIdentity(stored);
    if (
      rejectedAccessToken &&
      !haveSameIdentity(
        storedIdentity,
        getSessionIdentity({
          accessOrWorkspaceAgnosticToken: {
            token: rejectedAccessToken,
            expiresAt: '',
          },
        }),
      )
    )
      return null;

    const accessToken = getUsableToken(
      stored?.accessOrWorkspaceAgnosticToken,
      30_000,
    );
    const refreshToken = getUsableToken(stored?.refreshToken);
    if (
      accessToken &&
      accessToken !== rejectedAccessToken &&
      stored?.sessionSource === 'extension'
    ) {
      return accessToken;
    }

    if (stored?.sessionSource === 'extension' && refreshToken) {
      try {
        const renewed = await renewExtensionSession(settings, refreshToken);
        const renewedAccessToken = getUsableToken(
          renewed?.accessOrWorkspaceAgnosticToken,
        );

        if (
          !renewed ||
          !renewedAccessToken ||
          renewedAccessToken === rejectedAccessToken ||
          !getUsableToken(renewed.refreshToken) ||
          !haveSameIdentity(storedIdentity, getSessionIdentity(renewed))
        ) {
          throw new SessionRequestError(true);
        }

        await saveTwentyTokenPair({ ...renewed, sessionSource: 'extension' });
        return renewedAccessToken;
      } catch (error) {
        if (!(error instanceof SessionRequestError) || error.retryable)
          throw error;
      }
    }

    const browserTokens =
      accessToken &&
      stored?.sessionSource !== 'extension' &&
      accessToken !== rejectedAccessToken
        ? stored
        : await readBrowserSession();
    const browserIdentity = getSessionIdentity(browserTokens);

    if (
      !browserTokens ||
      !browserIdentity ||
      (storedIdentity && !haveSameIdentity(storedIdentity, browserIdentity))
    ) {
      return null;
    }

    try {
      return await createTwentyExtensionSession(
        settings,
        browserTokens,
        browserIdentity,
      );
    } catch (error) {
      if (error instanceof SessionRequestError && !error.retryable) return null;
      throw error;
    }
  });
