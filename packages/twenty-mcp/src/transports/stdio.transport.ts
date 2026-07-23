import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer } from '../server.js';
import type { ToolDependencies } from '../types.js';

export const startStdioTransport = async (
  dependencies: ToolDependencies,
): Promise<void> => {
  const server = createMcpServer(dependencies);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  const close = async (): Promise<void> => {
    await server.close();
  };

  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
};
