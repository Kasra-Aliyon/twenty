import assert from 'node:assert/strict';
import test from 'node:test';
import { deploy, httpsOrigin, imageDigest } from './deploy.mjs';

const environment = {
  COOLIFY_URL: 'https://deploy.example.com',
  COOLIFY_TOKEN: 'secret',
  COOLIFY_APP_UUID: 'app',
  TWENTY_IMAGE: `ghcr.io/example/twenty@sha256:${'a'.repeat(64)}`,
  TWENTY_MCP_IMAGE: `ghcr.io/example/mcp@sha256:${'b'.repeat(64)}`,
  TWENTY_PUBLIC_URL: 'https://crm.example.com',
  TWENTY_MCP_PUBLIC_URL: 'https://mcp.example.com',
  TWENTY_MCP_HTTP_BEARER_TOKEN: 'private-mcp-token',
  GITHUB_SHA: 'c'.repeat(40),
};

test('rejects mutable image tags and origins that could leak credentials', () => {
  assert.throws(() => imageDigest('ghcr.io/example/twenty:latest'));
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
  ]) {
    assert.throws(() => httpsOrigin(url));
  }
});

test('failed migrations stop verification and never report a successful release', async () => {
  const calls = [];
  await assert.rejects(
    deploy(
      environment,
      async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/deploy'))
          return Response.json({
            deployments: [{ resource_uuid: 'app', deployment_uuid: 'release' }],
          });
        if (url.endsWith('/deployments/release'))
          return Response.json({ status: 'failed' });
        return Response.json({});
      },
      async () => {},
    ),
    /Deployment failed/,
  );
  assert.equal(calls.length, 4);
  assert.equal(
    JSON.parse(calls[0].options.body).git_commit_sha,
    environment.GITHUB_SHA,
  );
});

test('accepted deployment alone is insufficient; requires public health and authenticated MCP tools', async () => {
  const calls = [];
  await deploy(
    environment,
    async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/deploy'))
        return Response.json({
          deployments: [{ resource_uuid: 'app', deployment_uuid: 'release' }],
        });
      if (url.endsWith('/deployments/release'))
        return Response.json({ status: 'finished' });
      if (url.endsWith('/mcp'))
        return Response.json({
          result: { tools: [{ name: 'twenty_list_objects' }] },
        });
      return Response.json({});
    },
    async () => {},
  );
  assert.equal(calls.length, 7);
  assert.equal(
    calls.at(-1).options.headers.Authorization,
    'Bearer private-mcp-token',
  );
  assert.ok(calls.every(({ options }) => options.redirect === 'error'));
});
