import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';

import {
  getEnvironmentValue,
  isAllowedApolloWebhookRequest,
  isManagedQuickTunnelUrl,
  resolveDevelopmentServerPort,
  setEnvironmentValue,
} from './start-development-utils';
import { waitForDevelopmentServer } from './wait-for-development-server';

describe('development startup helpers', () => {
  it('reads quoted and unquoted environment values', () => {
    const contents = [
      'ONE=value',
      'TWO="quoted value"',
      "export THREE='other value'",
    ].join('\n');

    assert.equal(getEnvironmentValue(contents, 'ONE'), 'value');
    assert.equal(getEnvironmentValue(contents, 'TWO'), 'quoted value');
    assert.equal(getEnvironmentValue(contents, 'THREE'), 'other value');
    assert.equal(getEnvironmentValue(contents, 'MISSING'), undefined);
  });

  it('replaces an environment value without changing neighboring values', () => {
    const contents = 'ONE=value\nTARGET=old\nTHREE=value\n';

    assert.equal(
      setEnvironmentValue(contents, 'TARGET', 'new'),
      'ONE=value\nTARGET=new\nTHREE=value\n',
    );
  });

  it('appends a missing environment value', () => {
    assert.equal(
      setEnvironmentValue('ONE=value\n', 'TARGET', 'new'),
      'ONE=value\nTARGET=new\n',
    );
  });

  it('resolves the backend port using process, file, then default precedence', () => {
    assert.equal(
      resolveDevelopmentServerPort('NODE_PORT=2002\n', '2003'),
      2003,
    );
    assert.equal(
      resolveDevelopmentServerPort('NODE_PORT=2002\n', undefined),
      2002,
    );
    assert.equal(resolveDevelopmentServerPort('', undefined), 2000);
  });

  it('rejects invalid backend ports before starting the webhook tunnel', () => {
    assert.throws(
      () => resolveDevelopmentServerPort('NODE_PORT=not-a-port\n', undefined),
      /NODE_PORT must be an integer between 1 and 65535/,
    );
    assert.throws(
      () => resolveDevelopmentServerPort('', '65536'),
      /NODE_PORT must be an integer between 1 and 65535/,
    );
  });

  it('recognizes only missing or TryCloudflare webhook URLs as managed', () => {
    assert.equal(isManagedQuickTunnelUrl(undefined), true);
    assert.equal(
      isManagedQuickTunnelUrl('https://random-words.trycloudflare.com'),
      true,
    );
    assert.equal(isManagedQuickTunnelUrl('https://apollo.example.com'), false);
  });

  it('allows only POST requests to a tokenized Apollo webhook path', () => {
    assert.equal(
      isAllowedApolloWebhookRequest(
        'POST',
        '/webhooks/apollo/enrichment/signed.token',
      ),
      true,
    );
    assert.equal(
      isAllowedApolloWebhookRequest(
        'GET',
        '/webhooks/apollo/enrichment/signed.token',
      ),
      false,
    );
    assert.equal(isAllowedApolloWebhookRequest('POST', '/graphql'), false);
    assert.equal(
      isAllowedApolloWebhookRequest('POST', '/webhooks/apollo/enrichment/'),
      false,
    );
  });

  it('waits for the configured backend health endpoint', async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === '/healthz' ? 200 : 404);
      response.end();
    });

    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolvePromise();
      });
    });

    const address = server.address();

    assert.ok(address && typeof address !== 'string');

    try {
      await waitForDevelopmentServer({
        port: address.port,
        timeoutInMilliseconds: 2_000,
      });
    } finally {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    }
  });
});
