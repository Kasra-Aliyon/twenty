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
        'Use twenty_list_objects and twenty_describe_object to discover live object and field names before generic records, saved views, or dashboard charts. Prefer read-only tools. Call twenty_get_sequence_capabilities before building an outreach sequence so conditions, Yes/No branches, automated versus manual execution, LinkedIn actions, phone enrichment, and task continuation are configured correctly. Only perform mutations the user requested, and only pass confirm=true after explicit confirmation of the exact targets. twenty_delete_record is recoverable; the advanced twenty_destroy_record is irreversible. Apollo enrichment calls an external paid service and requires confirmation of every target; phone results can arrive asynchronously. Email sending, campaigns, sequence activation/enrollment, enrollment skipping, and LinkedIn tools trigger or can accelerate external outreach. Preview campaign audiences before sending. User-owned email, drafts, connected accounts, record timelines, and Apollo enrichment require TWENTY_USER_TOKEN. Paginate large reads with next_cursor.',
    },
  );

  registerAllTools(server, dependencies);

  return server;
};
