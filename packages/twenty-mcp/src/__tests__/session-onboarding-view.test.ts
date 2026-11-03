import { runInNewContext } from 'node:vm';

import { renderConnectScript } from '../transports/session-onboarding-view.js';

const identity = {
  userId: '20202020-1111-4111-8111-111111111111',
  workspaceId: '20202020-2222-4222-8222-222222222222',
};
const setupBrowser = (
  currentUserId = identity.userId,
  pageOrigin = 'https://crm.example.com',
) => {
  const handlers: Record<string, () => Promise<void>> = {};
  const elements = Object.fromEntries(
    ['token', 'status', 'connect', 'check'].map((id) => [
      id,
      {
        value: id === 'token' ? 'personal-mcp-secret' : '',
        textContent: '',
        disabled: false,
        addEventListener: (_event: string, handler: () => Promise<void>) => {
          handlers[id] = handler;
        },
      },
    ]),
  );
  const getItem = jest.fn(() =>
    JSON.stringify({
      accessOrWorkspaceAgnosticToken: { token: 'browser-access' },
      refreshToken: { token: 'browser-refresh-never-copy' },
    }),
  );
  const fetchMock = jest.fn(
    async (input: string | URL, options?: RequestInit) => {
      if (input === '/metadata')
        return Response.json({
          data: {
            currentUser: {
              id: currentUserId,
              email: 'joris@example.com',
              currentWorkspace: { id: identity.workspaceId },
              availableWorkspaces: {
                availableWorkspacesForSignIn: [
                  { id: identity.workspaceId, loginToken: 'fresh-login-token' },
                ],
              },
            },
          },
        });
      expect(String(input)).toBe('https://crm.example.com/mcp-joris/session');
      expect(options?.headers).toMatchObject({
        Authorization: 'Bearer personal-mcp-secret',
      });
      return Response.json({
        connected: true,
        user: { email: 'joris@example.com' },
      });
    },
  );
  runInNewContext(renderConnectScript('https://crm.example.com', identity), {
    document: { getElementById: (id: string) => elements[id] },
    localStorage: { getItem },
    location: { origin: pageOrigin, href: `${pageOrigin}/mcp-joris/connect` },
    fetch: fetchMock,
    URL,
  });
  return { handlers, elements, getItem, fetchMock };
};

it('connects the browser user through the public path without copying browser refresh credentials', async () => {
  const browser = setupBrowser();
  await browser.handlers.connect!();
  expect(browser.fetchMock).toHaveBeenCalledTimes(2);
  expect(browser.fetchMock.mock.calls[1]?.[1]?.body).toBe(
    JSON.stringify({ login_token: 'fresh-login-token' }),
  );
  expect(JSON.stringify(browser.fetchMock.mock.calls)).not.toContain(
    'browser-refresh-never-copy',
  );
  expect(browser.elements.token?.value).toBe('');
  expect(browser.elements.status?.textContent).toContain(
    'Connected as joris@example.com',
  );
});

it('stops before authorizing a different signed-in CRM user', async () => {
  const browser = setupBrowser('20202020-3333-4333-8333-333333333333');
  await browser.handlers.connect!();
  expect(browser.fetchMock).toHaveBeenCalledTimes(1);
  expect(browser.elements.status?.textContent).toContain('different CRM user');
});

it('does not read browser credentials or transmit the MCP token from another origin', async () => {
  const browser = setupBrowser(identity.userId, 'https://attacker.example.com');
  await browser.handlers.connect!();
  expect(browser.getItem).not.toHaveBeenCalled();
  expect(browser.fetchMock).not.toHaveBeenCalled();
  expect(browser.elements.token?.value).toBe('');
});
