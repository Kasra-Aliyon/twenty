import { ApolloLink, gql, InMemoryCache } from '@apollo/client';
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { enableFetchMocks } from 'jest-fetch-mock';
import { Observable } from 'rxjs';

import { ApolloFactory } from '@/apollo/services/apollo.factory';
import { renewToken } from '@/auth/services/AuthService';
import { TOKEN_PAIR_LOCAL_STORAGE_KEY } from '@/auth/states/tokenPairState';
import { type AuthTokenPair } from '~/generated-metadata/graphql';

enableFetchMocks();

jest.mock('@/auth/services/AuthService', () => ({
  ...jest.requireActual('@/auth/services/AuthService'),
  renewToken: jest.fn(),
}));

const originalTokens: AuthTokenPair = {
  accessOrWorkspaceAgnosticToken: {
    token: 'expired-access-token',
    expiresAt: '2026-10-29T00:00:00.000Z',
  },
  refreshToken: {
    token: 'valid-refresh-token',
    expiresAt: '2026-12-29T00:00:00.000Z',
  },
};

const renewedTokens: AuthTokenPair = {
  accessOrWorkspaceAgnosticToken: {
    token: 'renewed-access-token',
    expiresAt: '2026-10-30T12:30:00.000Z',
  },
  refreshToken: {
    token: 'renewed-refresh-token',
    expiresAt: '2026-12-29T12:00:00.000Z',
  },
};

const saveTokens = (tokens: AuthTokenPair | null) => {
  localStorage.setItem(TOKEN_PAIR_LOCAL_STORAGE_KEY, JSON.stringify(tokens));
};

const authenticationError = new CombinedGraphQLErrors({
  errors: [
    { message: 'Token has expired.', extensions: { code: 'UNAUTHENTICATED' } },
  ],
});

const createClient = () => {
  const onUnauthenticatedError = jest.fn(() => saveTokens(null));
  const onTokenPairChange = jest.fn(saveTokens);
  const requestLink = new ApolloLink(
    (operation) =>
      new Observable((observer) => {
        if (
          operation.getContext().headers.authorization ===
          `Bearer ${renewedTokens.accessOrWorkspaceAgnosticToken.token}`
        ) {
          observer.next({ data: { currentUser: { id: 'current-user' } } });
          observer.complete();
        } else {
          observer.error(authenticationError);
        }
      }),
  );

  const client = new ApolloFactory({
    uri: 'http://localhost:2000/graphql',
    cache: new InMemoryCache(),
    currentWorkspace: null,
    currentWorkspaceMember: null,
    extraLinks: [requestLink],
    onUnauthenticatedError,
    onTokenPairChange,
  }).getClient();

  const request = () =>
    client.query({
      query: gql`
        query CurrentUser {
          currentUser {
            id
          }
        }
      `,
      fetchPolicy: 'network-only',
    });

  return { request, onUnauthenticatedError, onTokenPairChange };
};

describe('saved login during token renewal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    saveTokens(originalTokens);
  });

  afterEach(() => {
    jest.useRealTimers();
    localStorage.clear();
  });

  it.each([
    ['offline connection', new TypeError('Failed to fetch')],
    [
      'server maintenance',
      new ServerError('Service unavailable', {
        response: new Response('', { status: 503 }),
        bodyText: '',
      }),
    ],
    [
      'rate limit',
      new ServerError('Too many requests', {
        response: new Response('', { status: 429 }),
        bodyText: '',
      }),
    ],
    [
      'temporary GraphQL server error',
      new CombinedGraphQLErrors({
        errors: [
          {
            message: 'Database unavailable',
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          },
        ],
      }),
    ],
  ])(
    'should keep the saved login after %s and recover on the next request',
    async (_, error) => {
      jest.mocked(renewToken).mockRejectedValue(error);
      const { request, onUnauthenticatedError } = createClient();

      const failedRequest = expect(request()).rejects.toBeDefined();
      await jest.runAllTimersAsync();
      await failedRequest;

      expect(onUnauthenticatedError).not.toHaveBeenCalled();
      expect(
        JSON.parse(localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY)!),
      ).toEqual(originalTokens);

      jest.mocked(renewToken).mockResolvedValue(renewedTokens);
      await expect(request()).resolves.toMatchObject({
        data: { currentUser: { id: 'current-user' } },
      });
      expect(
        JSON.parse(localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY)!),
      ).toEqual(renewedTokens);
    },
  );

  it.each([
    ['expired refresh token', 'UNAUTHENTICATED', 'UNAUTHENTICATED'],
    ['revoked refresh token', 'FORBIDDEN', 'FORBIDDEN_EXCEPTION'],
    ['deleted refresh token', 'BAD_USER_INPUT', 'INVALID_INPUT'],
  ])(
    'should require sign-in when the server rejects the %s',
    async (_, code, subCode) => {
      jest.mocked(renewToken).mockRejectedValue(
        new CombinedGraphQLErrors({
          errors: [
            {
              message: 'Refresh token rejected',
              extensions: { code, subCode },
            },
          ],
        }),
      );
      const { request, onUnauthenticatedError } = createClient();

      await expect(request()).rejects.toBeDefined();
      expect(onUnauthenticatedError).toHaveBeenCalledTimes(1);
      expect(renewToken).toHaveBeenCalledTimes(1);
    },
  );

  it('should preserve a newer session when an old renewal is rejected', async () => {
    jest.mocked(renewToken).mockImplementation(async () => {
      saveTokens(renewedTokens);
      throw authenticationError;
    });
    const { request, onUnauthenticatedError } = createClient();

    await expect(request()).rejects.toBeDefined();

    expect(onUnauthenticatedError).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY)!),
    ).toEqual(renewedTokens);
  });

  it('should not restore a session when renewal finishes after sign-out', async () => {
    jest.mocked(renewToken).mockImplementation(async () => {
      saveTokens(null);
      return renewedTokens;
    });
    const { request, onTokenPairChange } = createClient();

    await expect(request()).rejects.toBeDefined();

    expect(onTokenPairChange).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY)).toBeNull();
  });

  it('should not overwrite a newer session with a late renewal response', async () => {
    jest.mocked(renewToken).mockImplementation(async () => {
      saveTokens(renewedTokens);
      return originalTokens;
    });
    const { request, onTokenPairChange } = createClient();

    await expect(request()).resolves.toMatchObject({
      data: { currentUser: { id: 'current-user' } },
    });

    expect(onTokenPairChange).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(TOKEN_PAIR_LOCAL_STORAGE_KEY)!),
    ).toEqual(renewedTokens);
  });

  it('should share a single renewal between concurrent clients', async () => {
    jest.mocked(renewToken).mockResolvedValue(renewedTokens);
    const firstClient = createClient();
    const secondClient = createClient();

    await expect(
      Promise.all([firstClient.request(), secondClient.request()]),
    ).resolves.toHaveLength(2);

    expect(renewToken).toHaveBeenCalledTimes(1);
    expect(firstClient.onUnauthenticatedError).not.toHaveBeenCalled();
    expect(secondClient.onUnauthenticatedError).not.toHaveBeenCalled();
  });
});
