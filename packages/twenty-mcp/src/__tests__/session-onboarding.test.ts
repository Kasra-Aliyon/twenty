import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHttpApp } from '../transports/http.transport.js';
import type { TwentyClient } from '../services/twenty-client.js';
import type { MetadataService } from '../services/metadata.service.js';

const identity = {
  userId: '20202020-1111-4111-8111-111111111111',
  workspaceId: '20202020-2222-4222-8222-222222222222',
};
const user = {
  id: identity.userId,
  email: 'joris@example.com',
  currentWorkspace: { id: identity.workspaceId },
};
let server: Server;
let endpoint: string;
const connectUserSession = jest.fn();
const getCurrentUser = jest.fn();
beforeEach(async () => {
  jest.clearAllMocks();
  connectUserSession.mockResolvedValue(user);
  getCurrentUser.mockResolvedValue({ currentUser: user });
  const app = createHttpApp(
    {
      client: { connectUserSession, getCurrentUser } as unknown as TwentyClient,
      metadata: {} as MetadataService,
      enableAdvanced: false,
    },
    {
      host: '127.0.0.1',
      port: 0,
      httpBearerToken: 'joris-token',
      publicCrmOrigin: 'https://crm.example.com',
      userSessionIdentity: identity,
    },
  );
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1');
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

it('serves a no-store connection page without credentials and with a restrictive CSP', async () => {
  const response = await fetch(`${endpoint}/connect`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'none'",
  );
  const page = await response.text();
  expect(page).toContain('Connect my account');
  expect(page).not.toContain('joris-token');
  const script = await (await fetch(`${endpoint}/connect.js`)).text();
  expect(script).toContain(identity.userId);
  expect(script).not.toContain('joris-token');
});

it.each([undefined, 'Bearer kasra-token'])(
  'rejects missing or another MCP credential (%s)',
  async (authorization) => {
    const response = await fetch(`${endpoint}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://crm.example.com',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ login_token: 'login' }),
    });
    expect(response.status).toBe(401);
    expect(connectUserSession).not.toHaveBeenCalled();
  },
);

it.each([undefined, 'https://attacker.example.com'])(
  'rejects session installation without the correct browser origin (%s)',
  async (origin) => {
    const response = await fetch(`${endpoint}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer joris-token',
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ login_token: 'login' }),
    });
    expect(response.status).toBe(403);
    expect(connectUserSession).not.toHaveBeenCalled();
  },
);

it('exchanges only a short-lived login token using the pinned CRM origin', async () => {
  const response = await fetch(`${endpoint}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer joris-token',
      Origin: 'https://crm.example.com',
    },
    body: JSON.stringify({ login_token: 'login' }),
  });
  expect(response.status).toBe(200);
  expect(connectUserSession).toHaveBeenCalledWith(
    'login',
    'https://crm.example.com',
  );
  expect(await response.text()).not.toContain('login');
});

it('reports pending personal authorization without failing process health', async () => {
  getCurrentUser.mockRejectedValue(new Error('private-provider-detail'));
  const response = await fetch(`${endpoint}/session`, {
    headers: { Authorization: 'Bearer joris-token' },
  });
  expect(await response.json()).toMatchObject({ connected: false });
  expect((await fetch(`${endpoint}/health`)).status).toBe(200);
});
