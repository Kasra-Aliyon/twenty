import { readFile, rename, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { TwentyApiError } from './errors.js';
import type { UserSessionIdentity } from '../types.js';
import {
  assertSessionIdentity,
  sessionSchema,
  type UserSessionTokens,
} from './user-session-identity.js';

// A dedicated user session enables user-scoped tools without storing a password.
// The token pair lives in a private volume because renewToken rotates refresh tokens.
export class UserSession {
  private pending: Promise<string> | undefined;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly baseUrl: URL,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly expectedIdentity?: UserSessionIdentity,
  ) {}

  private serialize<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => undefined);
    return result;
  }

  async getToken(): Promise<string> {
    if (this.pending !== undefined) return this.pending;
    this.pending = this.serialize(() => this.readOrRenew());
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async readOrRenew(): Promise<string> {
    let session: UserSessionTokens;
    try {
      session = sessionSchema.parse(
        JSON.parse(await readFile(this.file, 'utf8')),
      );
    } catch {
      throw new TwentyApiError({
        code: 'USER_SESSION_REQUIRED',
        message:
          'Install a valid token pair in TWENTY_USER_SESSION_FILE to enable user-scoped tools.',
      });
    }
    assertSessionIdentity(session, this.expectedIdentity);
    if (
      Date.parse(session.accessOrWorkspaceAgnosticToken.expiresAt) >
      Date.now() + 60_000
    ) {
      return session.accessOrWorkspaceAgnosticToken.token;
    }
    if (Date.parse(session.refreshToken.expiresAt) <= Date.now()) {
      throw new TwentyApiError({
        code: 'USER_SESSION_EXPIRED',
        message:
          'The MCP user session expired. Sign in again and replace its token-pair file.',
      });
    }
    const response = await this.fetchImplementation(
      new URL('metadata', this.baseUrl),
      {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query:
            'mutation RenewToken($appToken: String!) { renewToken(appToken: $appToken) { tokens { accessOrWorkspaceAgnosticToken { token expiresAt } refreshToken { token expiresAt } } } }',
          variables: { appToken: session.refreshToken.token },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    const envelope = z.object({
      data: z.object({ renewToken: z.object({ tokens: sessionSchema }) }),
    });
    const result = response.ok
      ? envelope.safeParse(await response.json())
      : undefined;
    if (result === undefined || !result.success) {
      // Provider errors can contain tokens; expose only an actionable generic error.
      throw new TwentyApiError({
        code: 'USER_SESSION_REFRESH_FAILED',
        message:
          'Could not renew the MCP user session. Sign in again if access was revoked.',
      });
    }
    const tokens = result.data.data.renewToken.tokens;
    assertSessionIdentity(tokens, this.expectedIdentity);
    await this.persist(tokens);
    return tokens.accessOrWorkspaceAgnosticToken.token;
  }

  async connect(
    loginToken: string,
    origin: string,
  ): Promise<{ id: string; email: string; workspaceId: string }> {
    return this.serialize(async () => {
      if (!this.expectedIdentity) {
        throw new Error('Personal user identity is not configured');
      }
      const request = async (
        query: string,
        variables: Record<string, string>,
        accessToken?: string,
      ): Promise<unknown> => {
        const response = await this.fetchImplementation(
          new URL('metadata', this.baseUrl),
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(this.timeoutMs),
            headers: {
              'content-type': 'application/json',
              ...(accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : {}),
            },
            body: JSON.stringify({ query, variables }),
          },
        );
        if (!response.ok) throw new Error('CRM session request was rejected');
        return response.json();
      };
      try {
        const result = z
          .object({
            data: z.object({
              getAuthTokensFromLoginToken: z.object({ tokens: sessionSchema }),
            }),
          })
          .parse(
            await request(
              'mutation ConnectMcp($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token expiresAt } refreshToken { token expiresAt } } } }',
              { loginToken, origin },
            ),
          );
        const tokens = result.data.getAuthTokensFromLoginToken.tokens;
        assertSessionIdentity(tokens, this.expectedIdentity);
        const identity = z
          .object({
            data: z.object({
              currentUser: z.object({
                id: z.uuid(),
                email: z.email(),
                currentWorkspace: z.object({ id: z.uuid() }),
              }),
            }),
          })
          .parse(
            await request(
              'query McpSessionIdentity { currentUser { id email currentWorkspace { id } } }',
              {},
              tokens.accessOrWorkspaceAgnosticToken.token,
            ),
          ).data.currentUser;
        if (
          identity.id !== this.expectedIdentity.userId ||
          identity.currentWorkspace.id !== this.expectedIdentity.workspaceId ||
          Date.parse(tokens.refreshToken.expiresAt) <= Date.now()
        ) {
          throw new Error('Wrong CRM identity');
        }
        await this.persist(tokens);
        return {
          id: identity.id,
          email: identity.email,
          workspaceId: identity.currentWorkspace.id,
        };
      } catch {
        throw new TwentyApiError({
          code: 'USER_SESSION_CONNECT_FAILED',
          message:
            'Could not connect the assigned CRM account. Sign in as the correct user and retry.',
        });
      }
    });
  }

  private async persist(tokens: UserSessionTokens): Promise<void> {
    await writeFile(`${this.file}.tmp`, JSON.stringify(tokens), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
  }
}
