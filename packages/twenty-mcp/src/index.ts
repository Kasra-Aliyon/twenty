#!/usr/bin/env node

import { readConfig } from './config.js';
import { MetadataService } from './services/metadata.service.js';
import { TwentyClient } from './services/twenty-client.js';
import { startHttpTransport } from './transports/http.transport.js';
import { startStdioTransport } from './transports/stdio.transport.js';

const main = async (): Promise<void> => {
  const config = readConfig();
  const client = new TwentyClient(config);
  const metadata = new MetadataService(client, config.metadataCacheTtlMs);
  const dependencies = {
    client,
    metadata,
    enableAdvanced: config.enableAdvanced,
  };

  if (config.transport === 'http') {
    await startHttpTransport(dependencies, config);
    return;
  }

  await startStdioTransport(dependencies);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `Twenty MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
