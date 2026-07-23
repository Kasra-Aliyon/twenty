import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const stagingDirectory = resolve(packageRoot, '.mcpb-build');
const serverDirectory = resolve(stagingDirectory, 'server');

await rm(stagingDirectory, { force: true, recursive: true });
await mkdir(serverDirectory, { recursive: true });

await build({
  entryPoints: [resolve(packageRoot, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  // MCP SDK's HTTP transport pulls in CommonJS-only Express internals. A
  // CommonJS artifact keeps those dynamic Node built-in requires executable.
  format: 'cjs',
  target: 'node24',
  outfile: resolve(serverDirectory, 'index.cjs'),
  legalComments: 'inline',
  sourcemap: false,
});

await Promise.all([
  copyFile(
    resolve(packageRoot, 'manifest.json'),
    resolve(stagingDirectory, 'manifest.json'),
  ),
  copyFile(
    resolve(packageRoot, 'README.md'),
    resolve(stagingDirectory, 'README.md'),
  ),
  copyFile(
    resolve(packageRoot, 'USAGE_GUIDE.md'),
    resolve(stagingDirectory, 'USAGE_GUIDE.md'),
  ),
  copyFile(
    resolve(workspaceRoot, 'LICENSE'),
    resolve(stagingDirectory, 'LICENSE'),
  ),
]);
