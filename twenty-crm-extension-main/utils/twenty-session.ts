import type { ExtensionSettings, TwentyTokenPair } from '../types';
import { getTwentyTokenPair, saveTwentyTokenPair } from './storage';

type SessionIdentity = {
  sub: string;
  workspaceId: string;
  authProvider: string;
};

let sessionOperation: Promise<unknown> = Promise.resolve();

export const withTwentySessionOperation = <TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const result = sessionOperation.then(operation, operation);
  sessionOperation = result.catch(() => undefined);
  return result;
};

const getSessionIdentity = (
  tokenPair: TwentyTokenPair | null,
): SessionIdentity | null => {
  try {
    const encodedPayload =
      tokenPair?.accessOrWorkspaceAgnosticToken.token.split('.')[1];
    if (!encodedPayload) return null;

    const payload = JSON.parse(
      atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as Record<string, unknown>;
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
  } catch {
    return null;
  }
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
  accessToken: string,
  query: string,
  variables?: Record<string, string>,
): Promise<TData> => {
  const response = await fetch(`${settings.twentyApiUrl}/metadata`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok)
    throw new Error(`CRM session request failed (${response.status})`);

  const result = (await response.json()) as {
    data?: TData;
    errors?: unknown[];
  };
  if (!result.data || result.errors?.length)
    throw new Error('CRM session request was rejected');
  return result.data;
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
    new Date(currentTokens.refreshToken.expiresAt).getTime() > Date.now()
  )
    return;

  const accessToken = browserTokens.accessOrWorkspaceAgnosticToken.token;
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
  if (!workspace?.loginToken)
    throw new Error('Sign in to the CRM to connect the extension');

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

  const tokens = result.getAuthTokensFromLoginToken.tokens;
  if (
    !haveSameIdentity(browserIdentity, getSessionIdentity(tokens)) ||
    typeof tokens.refreshToken?.token !== 'string' ||
    tokens.refreshToken.token === browserTokens.refreshToken?.token
  )
    throw new Error('CRM did not return an independent extension session');

  await saveTwentyTokenPair({ ...tokens, sessionSource: 'extension' });
};
