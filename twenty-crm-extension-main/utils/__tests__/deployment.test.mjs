import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDeploymentOrigin } from '../deployment.ts';

test('production URLs override local defaults and normalize the origin', () => {
  assert.equal(
    getDeploymentOrigin(
      'https://crm.example.com:443/',
      'http://localhost:2001',
    ),
    'https://crm.example.com',
  );
  assert.equal(
    getDeploymentOrigin(undefined, 'http://localhost:2001'),
    'http://localhost:2001',
  );
});

test('deployment configuration rejects credentials, insecure remote URLs and non-origins', () => {
  for (const value of [
    'http://crm.example.com',
    'https://user:secret@crm.example.com',
    'https://crm.example.com/path',
    'https://crm.example.com?token=secret',
    'https://crm.example.com#fragment',
    'file:///tmp/config',
  ]) {
    assert.throws(() => getDeploymentOrigin(value, 'http://localhost:2001'));
  }
});
