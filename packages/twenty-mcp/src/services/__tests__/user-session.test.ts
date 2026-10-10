import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserSession } from '../user-session.js';

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'twenty-session-test-'));
  file = join(directory, 'session.json');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const pair = (minutes: number, token = 'access', refresh = 'refresh') => ({
  accessOrWorkspaceAgnosticToken: {
    token,
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  },
  refreshToken: {
    token: refresh,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
});

it('renews concurrent requests once and persists the rotated pair across restarts', async () => {
  await writeFile(file, JSON.stringify(pair(-1)));
  const renewed = pair(30, 'new-access', 'new-refresh');
  const fetchMock = jest.fn(async () =>
    Response.json({ data: { renewToken: { tokens: renewed } } }),
  );
  const session = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    fetchMock,
  );
  expect(await Promise.all([session.getToken(), session.getToken()])).toEqual([
    'new-access',
    'new-access',
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(renewed);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(
    await new UserSession(
      file,
      new URL('https://crm.example.com/'),
      1000,
      fetchMock,
    ).getToken(),
  ).toBe('new-access');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('fails without exposing provider messages or overwriting the last session on renewal failure', async () => {
  const original = JSON.stringify(pair(-1));
  await writeFile(file, original);
  const fetchMock = jest.fn(async () =>
    Response.json({ errors: [{ message: 'sensitive-provider-data' }] }),
  );
  const session = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    fetchMock,
  );
  await expect(session.getToken()).rejects.toMatchObject({
    code: 'USER_SESSION_REFRESH_FAILED',
  });
  expect(await readFile(file, 'utf8')).toBe(original);
});

it('reports missing session setup without calling the CRM', async () => {
  const fetchMock = jest.fn();
  const session = new UserSession(
    file,
    new URL('https://crm.example.com/'),
    1000,
    fetchMock,
  );
  await expect(session.getToken()).rejects.toMatchObject({
    code: 'USER_SESSION_REQUIRED',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
