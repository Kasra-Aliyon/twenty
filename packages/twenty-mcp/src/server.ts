import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { registerAllTools } from './tools/register-all.js';
import type { ToolDependencies } from './types.js';

export const createMcpServer = (dependencies: ToolDependencies): McpServer => {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions:
        'Use twenty_list_objects and twenty_describe_object to discover live object and field names before generic records, saved views, or dashboard charts. Prefer read-only tools. Only perform mutations the user requested, and only pass confirm=true after explicit confirmation of the exact targets. twenty_delete_record is recoverable; the advanced twenty_destroy_record is irreversible. Email sending, campaigns, sequence activation/enrollment, and LinkedIn tools trigger external outreach. Preview campaign audiences before sending. User-owned email, drafts, connected accounts, and record timelines require TWENTY_USER_TOKEN. Paginate large reads with next_cursor.',
    },
  );

  registerAllTools(server, dependencies);

  return server;
};
