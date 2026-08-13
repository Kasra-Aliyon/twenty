import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import {
  createServer,
  request as createHttpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getEnvironmentValue,
  isAllowedApolloWebhookRequest,
  isManagedQuickTunnelUrl,
  resolveDevelopmentServerPort,
  setEnvironmentValue,
} from './start-development-utils';

const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const SERVER_ENV_PATH = resolve(WORKSPACE_ROOT, 'packages/twenty-server/.env');
const WEBHOOK_BASE_URL_VARIABLE = 'APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL';
const MAX_WEBHOOK_BODY_SIZE_IN_BYTES = 1_000_000;
const TUNNEL_START_TIMEOUT_IN_MILLISECONDS = 60_000;
const TUNNEL_RESTART_DELAY_IN_MILLISECONDS = 3_000;

type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type ManagedTunnel = {
  childProcess: ChildProcess;
  publicBaseUrl: string;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });

const waitForProcessExit = (
  childProcess: ChildProcess,
): Promise<ProcessExit> => {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve({
      code: childProcess.exitCode,
      signal: childProcess.signalCode,
    });
  }

  return new Promise((resolvePromise) => {
    childProcess.once('exit', (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
};

const signalProcessGroup = (
  childProcess: ChildProcess,
  signal: NodeJS.Signals,
): void => {
  if (!childProcess.pid || childProcess.exitCode !== null) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      childProcess.kill(signal);
    } else {
      process.kill(-childProcess.pid, signal);
    }
  } catch {
    // The process may have exited between the status check and the signal.
  }
};

const stopProcess = async (
  childProcess: ChildProcess | undefined,
): Promise<void> => {
  if (!childProcess || childProcess.exitCode !== null) {
    return;
  }

  signalProcessGroup(childProcess, 'SIGTERM');

  const exitedGracefully = await Promise.race([
    waitForProcessExit(childProcess).then(() => true),
    wait(5_000).then(() => false),
  ]);

  if (!exitedGracefully) {
    signalProcessGroup(childProcess, 'SIGKILL');
    await waitForProcessExit(childProcess);
  }
};

const forwardApolloWebhook = (
  serverPort: number,
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  if (!isAllowedApolloWebhookRequest(request.method, request.url)) {
    response.writeHead(404);
    response.end();
    return;
  }

  const bodyChunks: Buffer[] = [];
  let bodySize = 0;
  let requestIsTooLarge = false;

  request.on('data', (chunk: Buffer) => {
    if (requestIsTooLarge) {
      return;
    }

    bodySize += chunk.length;

    if (bodySize > MAX_WEBHOOK_BODY_SIZE_IN_BYTES) {
      requestIsTooLarge = true;
      response.writeHead(413);
      response.end();
      return;
    }

    bodyChunks.push(chunk);
  });

  request.on('end', () => {
    if (requestIsTooLarge) {
      return;
    }

    const body = Buffer.concat(bodyChunks);
    const proxyRequest = createHttpRequest(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: request.url,
        method: 'POST',
        headers: {
          'content-type': request.headers['content-type'] ?? 'application/json',
          'content-length': body.length,
          'user-agent':
            request.headers['user-agent'] ?? 'twenty-apollo-webhook-proxy',
        },
      },
      (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode ?? 502, {
          'content-type':
            proxyResponse.headers['content-type'] ?? 'application/json',
        });
        proxyResponse.pipe(response);
      },
    );

    proxyRequest.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502);
      }
      response.end();
    });

    proxyRequest.end(body);
  });

  request.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(400);
    }
    response.end();
  });
};

const startRestrictedWebhookProxy = async (
  serverPort: number,
): Promise<{
  server: Server;
  port: number;
}> => {
  const server = createServer((request, response) => {
    forwardApolloWebhook(serverPort, request, response);
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePromise();
    });
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Could not determine the Apollo webhook proxy port');
  }

  return { server, port: address.port };
};

const closeServer = async (server: Server | undefined): Promise<void> => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
  });
};

const startCloudflared = async (proxyPort: number): Promise<ManagedTunnel> => {
  const childProcess = spawn(
    'cloudflared',
    ['tunnel', '--url', `http://127.0.0.1:${proxyPort}`],
    {
      cwd: WORKSPACE_ROOT,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        TUNNEL_TRANSPORT_PROTOCOL: 'http2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let recentOutput = '';
  let publicBaseUrl: string | undefined;
  let tunnelIsRegistered = false;

  const readinessPromise = new Promise<ManagedTunnel>(
    (resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out while waiting for the Cloudflare Tunnel'));
      }, TUNNEL_START_TIMEOUT_IN_MILLISECONDS);

      const inspectOutput = (chunk: Buffer) => {
        const text = chunk.toString();

        process.stderr.write(text);
        recentOutput = `${recentOutput}${text}`.slice(-20_000);

        publicBaseUrl ??= recentOutput.match(
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
        )?.[0];
        tunnelIsRegistered ||= /Registered tunnel connection/.test(
          recentOutput,
        );

        if (publicBaseUrl && tunnelIsRegistered) {
          clearTimeout(timeout);
          resolvePromise({ childProcess, publicBaseUrl });
        }
      };

      childProcess.stdout?.on('data', inspectOutput);
      childProcess.stderr?.on('data', inspectOutput);
      childProcess.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      childProcess.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Cloudflare Tunnel exited before it was ready (code ${code}, signal ${signal})`,
          ),
        );
      });
    },
  );

  try {
    return await readinessPromise;
  } catch (error) {
    await stopProcess(childProcess);
    throw error;
  }
};

const startApplication = (serverPort: number, detached = true): ChildProcess =>
  spawn('yarn', ['start:application:core'], {
    cwd: WORKSPACE_ROOT,
    detached: detached && process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_PORT: String(serverPort),
    },
    stdio: 'inherit',
  });

const startApplicationWithoutTunnel = async (
  serverPort: number,
): Promise<number> => {
  const applicationProcess = startApplication(serverPort, false);
  const { code } = await waitForProcessExit(applicationProcess);

  return code ?? 1;
};

const cloudflaredIsInstalled = (): boolean =>
  spawnSync('cloudflared', ['--version'], {
    stdio: 'ignore',
  }).status === 0;

const runManagedDevelopment = async (): Promise<number> => {
  const serverEnvironment = await readFile(SERVER_ENV_PATH, 'utf8');
  const serverPort = resolveDevelopmentServerPort(
    serverEnvironment,
    process.env.NODE_PORT,
  );
  const configuredWebhookBaseUrl = getEnvironmentValue(
    serverEnvironment,
    WEBHOOK_BASE_URL_VARIABLE,
  );
  const tunnelIsDisabled =
    process.env.TWENTY_DISABLE_LOCAL_APOLLO_TUNNEL === 'true';

  if (tunnelIsDisabled || !isManagedQuickTunnelUrl(configuredWebhookBaseUrl)) {
    if (tunnelIsDisabled) {
      console.log(
        '[Apollo phone tunnel] Disabled by TWENTY_DISABLE_LOCAL_APOLLO_TUNNEL=true',
      );
    } else {
      console.log(
        `[Apollo phone tunnel] Using configured stable URL: ${configuredWebhookBaseUrl}`,
      );
    }

    return startApplicationWithoutTunnel(serverPort);
  }

  if (!cloudflaredIsInstalled()) {
    console.warn(
      '[Apollo phone tunnel] cloudflared is not installed; starting Twenty without phone webhook tunneling.',
    );
    console.warn(
      '[Apollo phone tunnel] On macOS, install it once with: brew install cloudflared',
    );

    return startApplicationWithoutTunnel(serverPort);
  }

  const { server: proxyServer, port: proxyPort } =
    await startRestrictedWebhookProxy(serverPort);

  console.log(
    `[Apollo phone tunnel] Restricted webhook proxy listening on 127.0.0.1:${proxyPort}`,
  );

  let activeApplicationProcess: ChildProcess | undefined;
  let activeTunnelProcess: ChildProcess | undefined;
  let stopWasRequested = false;
  let resolveStopRequest: (() => void) | undefined;
  const stopRequest = new Promise<void>((resolvePromise) => {
    resolveStopRequest = resolvePromise;
  });

  const requestStop = () => {
    if (stopWasRequested) {
      return;
    }

    stopWasRequested = true;
    resolveStopRequest?.();
  };

  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  try {
    while (!stopWasRequested) {
      let managedTunnel: ManagedTunnel;

      try {
        managedTunnel = await startCloudflared(proxyPort);
      } catch (error) {
        console.error(
          `[Apollo phone tunnel] ${
            error instanceof Error ? error.message : String(error)
          }`,
        );

        if (!stopWasRequested) {
          console.log(
            `[Apollo phone tunnel] Retrying in ${
              TUNNEL_RESTART_DELAY_IN_MILLISECONDS / 1_000
            } seconds...`,
          );
          await Promise.race([
            wait(TUNNEL_RESTART_DELAY_IN_MILLISECONDS),
            stopRequest,
          ]);
        }

        continue;
      }

      activeTunnelProcess = managedTunnel.childProcess;

      const currentEnvironment = await readFile(SERVER_ENV_PATH, 'utf8');
      const nextEnvironment = setEnvironmentValue(
        currentEnvironment,
        WEBHOOK_BASE_URL_VARIABLE,
        managedTunnel.publicBaseUrl,
      );

      if (nextEnvironment !== currentEnvironment) {
        await writeFile(SERVER_ENV_PATH, nextEnvironment);
      }

      console.log(
        `[Apollo phone tunnel] Ready at ${managedTunnel.publicBaseUrl}`,
      );
      console.log(
        '[Apollo phone tunnel] Only Apollo phone webhook requests are publicly forwarded.',
      );

      activeApplicationProcess = startApplication(serverPort);

      const outcome = await Promise.race([
        waitForProcessExit(activeApplicationProcess).then((exit) => ({
          type: 'application' as const,
          exit,
        })),
        waitForProcessExit(activeTunnelProcess).then((exit) => ({
          type: 'tunnel' as const,
          exit,
        })),
        stopRequest.then(() => ({ type: 'stop' as const })),
      ]);

      if (outcome.type === 'application') {
        await stopProcess(activeTunnelProcess);
        activeTunnelProcess = undefined;

        return outcome.exit.code ?? (outcome.exit.signal ? 1 : 0);
      }

      if (outcome.type === 'stop') {
        break;
      }

      console.warn(
        `[Apollo phone tunnel] Tunnel stopped (code ${outcome.exit.code}, signal ${outcome.exit.signal}); restarting the tunnel and application.`,
      );
      await stopProcess(activeApplicationProcess);
      activeApplicationProcess = undefined;
      activeTunnelProcess = undefined;

      await Promise.race([
        wait(TUNNEL_RESTART_DELAY_IN_MILLISECONDS),
        stopRequest,
      ]);
    }
  } finally {
    await Promise.all([
      stopProcess(activeApplicationProcess),
      stopProcess(activeTunnelProcess),
    ]);
    await closeServer(proxyServer);
  }

  return 0;
};

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  runManagedDevelopment()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `[Development startup] ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exitCode = 1;
    });
}
