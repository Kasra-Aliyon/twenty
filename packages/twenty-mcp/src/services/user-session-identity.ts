import { z } from 'zod';

import type { UserSessionIdentity } from '../types.js';
import { TwentyApiError } from './errors.js';

export const sessionSchema = z.object({
  accessOrWorkspaceAgnosticToken: z.object({
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
  }),
  refreshToken: z.object({
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
  }),
});

export type UserSessionTokens = z.infer<typeof sessionSchema>;

export const assertSessionIdentity = (
  tokens: UserSessionTokens,
  expected: UserSessionIdentity | undefined,
): void => {
  if (!expected) return;
  try {
    const encoded = tokens.accessOrWorkspaceAgnosticToken.token.split('.')[1];
    const payload = JSON.parse(
      Buffer.from(encoded ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    if (
      payload.type === 'ACCESS' &&
      payload.sub === expected.userId &&
      payload.workspaceId === expected.workspaceId &&
      payload.isImpersonating !== true &&
      payload.authProvider !== 'impersonation'
    )
      return;
  } catch {
    // Treat malformed and wrong-user sessions identically, without exposing tokens.
  }
  throw new TwentyApiError({
    code: 'USER_SESSION_IDENTITY_MISMATCH',
    message:
      'This MCP connection only accepts its assigned CRM user and workspace.',
  });
};
