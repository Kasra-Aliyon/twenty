import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

export function httpsOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Expected an HTTPS origin without credentials, query or path',
    );
  }
  return url.origin;
}

export function imageDigest(value) {
  if (!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error('Expected an immutable GHCR image digest');
  }
  return value;
}

export async function deploy(
  env = process.env,
  fetcher = fetch,
  sleep = wait,
  checkOnly = false,
) {
  for (const key of [
    'COOLIFY_URL',
    'COOLIFY_TOKEN',
    'COOLIFY_APP_UUID',
    'TWENTY_IMAGE',
    'TWENTY_MCP_IMAGE',
    'TWENTY_PUBLIC_URL',
    'TWENTY_MCP_PUBLIC_URL',
    'TWENTY_MCP_HTTP_BEARER_TOKEN',
    'GITHUB_SHA',
  ]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const base = httpsOrigin(env.COOLIFY_URL);
  const crm = httpsOrigin(env.TWENTY_PUBLIC_URL);
  const mcp = httpsOrigin(env.TWENTY_MCP_PUBLIC_URL);
  const app = encodeURIComponent(env.COOLIFY_APP_UUID);
  const images = ['TWENTY_IMAGE', 'TWENTY_MCP_IMAGE'].map((key) => ({
    key,
    value: imageDigest(env[key]),
    is_preview: false,
    is_buildtime: false,
    is_runtime: true,
    is_literal: true,
  }));
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA))
    throw new Error('Expected a full Git commit SHA');

  const api = async (path, method = 'GET', body) => {
    const response = await fetcher(`${base}/api/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.COOLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    // Coolify response bodies can contain secrets. Never log them.
    if (!response.ok)
      throw new Error(`Coolify ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };

  if (checkOnly) {
    await api(`applications/${app}`);
    console.log('Deployment configuration and Coolify access verified');
    return;
  }

  // Pin both the Compose source and image pair to the release built by this run.
  await api(`applications/${app}`, 'PATCH', { git_commit_sha: env.GITHUB_SHA });
  await api(`applications/${app}/envs/bulk`, 'PATCH', { data: images });
  const queued = await api('deploy', 'POST', {
    uuid: env.COOLIFY_APP_UUID,
    force: false,
  });
  const deployment = queued.deployments?.find(
    (item) => item.resource_uuid === env.COOLIFY_APP_UUID,
  );
  if (!deployment?.deployment_uuid)
    throw new Error('Coolify did not return a deployment UUID');

  let finished = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await api(
      `deployments/${encodeURIComponent(deployment.deployment_uuid)}`,
    );
    if (result.status === 'finished') {
      finished = true;
      break;
    }
    if (['failed', 'cancelled', 'canceled'].includes(result.status))
      throw new Error(`Deployment ${result.status}; inspect Coolify logs`);
    await sleep(10_000);
  }
  if (!finished)
    throw new Error(
      'Timed out waiting for Coolify; inspect it before retrying',
    );

  for (const url of [`${crm}/healthz`, `${mcp}/health`]) {
    const response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `Public health check failed: ${url} (${response.status})`,
      );
  }
  const response = await fetcher(`${mcp}/mcp`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${env.TWENTY_MCP_HTTP_BEARER_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  if (!response.ok)
    throw new Error(`Authenticated MCP check failed: HTTP ${response.status}`);
  const result = await response.json();
  if (!result.result?.tools?.length) throw new Error('MCP returned no tools');
  console.log(`Production deployment verified: ${env.GITHUB_SHA}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await deploy(process.env, fetch, wait, process.argv.includes('--check'));
}
