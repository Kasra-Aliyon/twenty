import { readFile, rename, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { TwentyApiError } from './errors.js';

const tokenSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
});
const sessionSchema = z.object({
  accessOrWorkspaceAgnosticToken: tokenSchema,
  refreshToken: tokenSchema,
});
type Session = z.infer<typeof sessionSchema>;

// A dedicated user session enables user-scoped tools without storing a password.
// The token pair lives in a private volume because renewToken rotates refresh tokens.
export class UserSession {
  private pending: Promise<string> | undefined;

  constructor(
    private readonly file: string,
    private readonly baseUrl: URL,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async getToken(): Promise<string> {
    if (this.pending !== undefined) return this.pending;
    this.pending = this.readOrRenew();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async readOrRenew(): Promise<string> {
    let session: Session;
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
    await writeFile(`${this.file}.tmp`, JSON.stringify(tokens), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
    return tokens.accessOrWorkspaceAgnosticToken.token;
  }
}
