import { readFile } from 'node:fs/promises';
import { get as createHttpGetRequest } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDevelopmentServerPort } from './start-development-utils';

const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const SERVER_ENV_PATH = resolve(WORKSPACE_ROOT, 'packages/twenty-server/.env');
const HEALTH_CHECK_INTERVAL_IN_MILLISECONDS = 500;
const HEALTH_CHECK_REQUEST_TIMEOUT_IN_MILLISECONDS = 2_000;
const SERVER_START_TIMEOUT_IN_MILLISECONDS = 300_000;

type WaitForDevelopmentServerOptions = {
  port: number;
  timeoutInMilliseconds?: number;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });

const isDevelopmentServerHealthy = (port: number): Promise<boolean> =>
  new Promise((resolvePromise) => {
    const request = createHttpGetRequest(
      {
        hostname: '127.0.0.1',
        path: '/healthz',
        port,
        timeout: HEALTH_CHECK_REQUEST_TIMEOUT_IN_MILLISECONDS,
      },
      (response) => {
        response.resume();
        resolvePromise(
          response.statusCode !== undefined &&
            response.statusCode >= 200 &&
            response.statusCode < 300,
        );
      },
    );

    request.once('timeout', () => request.destroy());
    request.once('error', () => resolvePromise(false));
  });

export const waitForDevelopmentServer = async ({
  port,
  timeoutInMilliseconds = SERVER_START_TIMEOUT_IN_MILLISECONDS,
}: WaitForDevelopmentServerOptions): Promise<void> => {
  const deadline = Date.now() + timeoutInMilliseconds;

  while (Date.now() < deadline) {
    if (await isDevelopmentServerHealthy(port)) {
      return;
    }

    await wait(HEALTH_CHECK_INTERVAL_IN_MILLISECONDS);
  }

  throw new Error(
    `Twenty server did not become healthy on port ${port} within ${timeoutInMilliseconds}ms`,
  );
};

const readServerEnvironment = async (): Promise<string> => {
  try {
    return await readFile(SERVER_ENV_PATH, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
};

const run = async (): Promise<void> => {
  const serverEnvironment = await readServerEnvironment();
  const port = resolveDevelopmentServerPort(
    serverEnvironment,
    process.env.NODE_PORT,
  );

  process.stdout.write(
    `Waiting for Twenty server health check on http://localhost:${port}/healthz\n`,
  );
  await waitForDevelopmentServer({ port });
};

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
