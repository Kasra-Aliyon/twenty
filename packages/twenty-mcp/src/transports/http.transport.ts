import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createMcpServer } from '../server.js';
import type { ToolDependencies, TwentyMcpConfig } from '../types.js';

const isAllowedOrigin = (origin: string | undefined, host: string): boolean => {
  if (origin === undefined) {
    return true;
  }

  try {
    const originUrl = new URL(origin);

    return (
      originUrl.hostname === host ||
      originUrl.hostname === '127.0.0.1' ||
      originUrl.hostname === 'localhost'
    );
  } catch {
    return false;
  }
};

export const startHttpTransport = async (
  dependencies: ToolDependencies,
  config: Pick<TwentyMcpConfig, 'host' | 'httpBearerToken' | 'port'>,
): Promise<void> => {
  const app = createMcpExpressApp({ host: config.host });

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.post('/mcp', (request, response) => {
    void (async () => {
      if (
        config.httpBearerToken !== undefined &&
        request.get('authorization') !== `Bearer ${config.httpBearerToken}`
      ) {
        response.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Missing or invalid bearer token',
          },
          id: null,
        });
        return;
      }

      if (!isAllowedOrigin(request.get('origin'), config.host)) {
        response.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Origin not allowed',
          },
          id: null,
        });
        return;
      }

      const server = createMcpServer(dependencies);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      response.on('close', () => {
        void transport.close();
        void server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
      } catch (error) {
        if (!response.headersSent) {
          response.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message:
                error instanceof Error ? error.message : 'Internal error',
            },
            id: null,
          });
        }
      }
    })();
  });

  app.all('/mcp', (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  });

  const httpServer = app.listen(config.port, config.host, () => {
    process.stderr.write(
      `Twenty MCP HTTP server listening at http://${config.host}:${config.port}/mcp\n`,
    );
  });

  const close = (): void => {
    httpServer.close();
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);
};

export const httpTransportTesting = { isAllowedOrigin };
