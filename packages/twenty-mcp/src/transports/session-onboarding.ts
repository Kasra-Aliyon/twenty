import { randomBytes } from 'node:crypto';

import type { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';

import type { ToolDependencies, TwentyMcpConfig } from '../types.js';
import {
  renderConnectPage,
  renderConnectScript,
} from './session-onboarding-view.js';

export type SessionOnboardingConfig = Pick<
  TwentyMcpConfig,
  'publicCrmOrigin' | 'userSessionIdentity' | 'httpBearerToken'
>;

export const registerSessionOnboarding = (
  app: ReturnType<typeof createMcpExpressApp>,
  dependencies: ToolDependencies,
  config: SessionOnboardingConfig,
): void => {
  if (!config.publicCrmOrigin || !config.userSessionIdentity) return;
  const publicCrmOrigin = config.publicCrmOrigin;
  const userSessionIdentity = config.userSessionIdentity;

  app.get('/connect', (_request, response) => {
    const nonce = randomBytes(18).toString('base64');
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    });
    response.type('html').send(renderConnectPage(nonce));
  });
  app.get('/connect.js', (_request, response) => {
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response
      .type('application/javascript')
      .send(renderConnectScript(publicCrmOrigin, userSessionIdentity));
  });

  app.use('/session', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (
      !config.httpBearerToken ||
      request.get('authorization') !== `Bearer ${config.httpBearerToken}`
    ) {
      response
        .status(401)
        .json({ error: 'Missing or invalid MCP access token' });
      return;
    }
    const origin = request.get('origin');
    if ((request.method === 'POST' || origin) && origin !== publicCrmOrigin) {
      response
        .status(403)
        .json({ error: 'Open the connection page on your CRM origin' });
      return;
    }
    next();
  });
  app.get('/session', (_request, response) => {
    void dependencies.client
      .getCurrentUser()
      .then((result) => {
        response.json({ connected: true, user: result.currentUser });
      })
      .catch(() => {
        response.json({
          connected: false,
          message: 'Sign in to the CRM and connect your assigned account.',
        });
      });
  });
  app.post('/session', (request, response) => {
    const parsed = z
      .object({ login_token: z.string().min(1).max(16_384) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) {
      response
        .status(400)
        .json({ error: 'A fresh CRM login token is required' });
      return;
    }
    void dependencies.client
      .connectUserSession(parsed.data.login_token, publicCrmOrigin)
      .then((user) => {
        response.json({ connected: true, user });
      })
      .catch(() => {
        response.status(403).json({
          error:
            'Could not connect the assigned CRM account. Sign in as the correct user and retry.',
        });
      });
  });
};
