import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserSession } from '../user-session.js';

const identity = {
  userId: '20202020-1111-4111-8111-111111111111',
  workspaceId: '20202020-2222-4222-8222-222222222222',
};
const wrongUserId = '20202020-3333-4333-8333-333333333333';
const tokens = (
  userId = identity.userId,
  minutes = 30,
  refreshToken = 'dedicated-refresh',
) => ({
  accessOrWorkspaceAgnosticToken: {
    token: `header.${Buffer.from(JSON.stringify({ type: 'ACCESS', sub: userId, workspaceId: identity.workspaceId, authProvider: 'google' })).toString('base64url')}.signature`,
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  },
  refreshToken: {
    token: refreshToken,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
});
let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'personal-mcp-test-'));
  file = join(directory, 'session.json');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const connectionFetch = (
  issuedUser = identity.userId,
  verifiedUser = issuedUser,
) =>
  jest.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as { query: string };
    return body.query.includes('ConnectMcp')
      ? Response.json({
          data: { getAuthTokensFromLoginToken: { tokens: tokens(issuedUser) } },
        })
      : Response.json({
          data: {
            currentUser: {
              id: verifiedUser,
              email: 'joris@example.com',
              currentWorkspace: { id: identity.workspaceId },
            },
          },
        });
  });

it('connects only the assigned user and persists a private dedicated renewable session', async () => {
  const fetchMock = connectionFetch();
  const session = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    fetchMock,
    identity,
  );
  expect(
    await session.connect('short-lived-login', 'https://crm.example.com'),
  ).toEqual({
    workspaceId: identity.workspaceId,
    id: identity.userId,
    email: 'joris@example.com',
  });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  expect(saved.refreshToken.token).toBe('dedicated-refresh');
  expect(JSON.stringify(saved)).not.toContain('short-lived-login');
  expect(await session.getToken()).toBe(
    saved.accessOrWorkspaceAgnosticToken.token,
  );
  expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
    Authorization: `Bearer ${saved.accessOrWorkspaceAgnosticToken.token}`,
  });
});

it.each([
  [wrongUserId, wrongUserId],
  [identity.userId, wrongUserId],
])(
  'rejects another user without replacing an existing session (%s, %s)',
  async (issued, verified) => {
    const original = JSON.stringify(tokens());
    await writeFile(file, original);
    const session = new UserSession(
      file,
      new URL('https://crm.example.com/'),
      1000,
      connectionFetch(issued, verified),
      identity,
    );
    await expect(
      session.connect('login', 'https://crm.example.com'),
    ).rejects.toMatchObject({ code: 'USER_SESSION_CONNECT_FAILED' });
    expect(await readFile(file, 'utf8')).toBe(original);
  },
);

it('rejects a manually installed wrong-user session before making a CRM request', async () => {
  await writeFile(file, JSON.stringify(tokens(wrongUserId)));
  const fetchMock = jest.fn();
  const session = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    fetchMock,
    identity,
  );
  await expect(session.getToken()).rejects.toMatchObject({
    code: 'USER_SESSION_IDENTITY_MISMATCH',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not persist a renewed token for a different account', async () => {
  const original = JSON.stringify(tokens(identity.userId, -1));
  await writeFile(file, original);
  const fetchMock = jest.fn(async () =>
    Response.json({ data: { renewToken: { tokens: tokens(wrongUserId) } } }),
  );
  const session = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    fetchMock,
    identity,
  );
  await expect(session.getToken()).rejects.toMatchObject({
    code: 'USER_SESSION_IDENTITY_MISMATCH',
  });
  expect(await readFile(file, 'utf8')).toBe(original);
});

it('keeps personal session files independent across MCP services', async () => {
  const first = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    connectionFetch(),
    identity,
  );
  await first.connect('login', 'https://crm.example.com');
  const otherFile = join(directory, 'other.json');
  const second = new UserSession(
    otherFile,
    new URL('https://crm.example.com/'),
    1000,
    connectionFetch(wrongUserId),
    { ...identity, userId: wrongUserId },
  );
  await second.connect('other-login', 'https://crm.example.com');
  expect(await first.getToken()).not.toBe(await second.getToken());
});
