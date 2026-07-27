import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEnvironmentValue,
  isAllowedApolloWebhookRequest,
  isManagedQuickTunnelUrl,
  setEnvironmentValue,
} from './start-development-utils';

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

  it('recognizes only missing or TryCloudflare webhook URLs as managed', () => {
    assert.equal(isManagedQuickTunnelUrl(undefined), true);
    assert.equal(
      isManagedQuickTunnelUrl('https://random-words.trycloudflare.com'),
      true,
    );
    assert.equal(
      isManagedQuickTunnelUrl('https://apollo.example.com'),
      false,
    );
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
    assert.equal(
      isAllowedApolloWebhookRequest('POST', '/graphql'),
      false,
    );
    assert.equal(
      isAllowedApolloWebhookRequest(
        'POST',
        '/webhooks/apollo/enrichment/',
      ),
      false,
    );
  });
});
