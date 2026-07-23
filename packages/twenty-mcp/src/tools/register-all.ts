import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ToolDependencies } from '../types.js';
import { registerAdvancedReadTools } from './advanced-read.tools.js';
import { registerCompanyTools } from './companies.tools.js';
import { registerDiscoveryTools } from './discovery.tools.js';
import { registerLinkedinTools } from './linkedin.tools.js';
import { registerListTools } from './lists.tools.js';
import { registerOpportunityTools } from './opportunities.tools.js';
import { registerPeopleTools } from './people.tools.js';
import { registerRecordTools } from './records.tools.js';
import { registerSequenceTools } from './sequences.tools.js';
import { registerTaskAndNoteTools } from './tasks-notes.tools.js';
import { registerUniboxTools } from './unibox.tools.js';

export const registerAllTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  registerDiscoveryTools(server, dependencies);
  registerRecordTools(server, dependencies);
  registerPeopleTools(server, dependencies);
  registerCompanyTools(server, dependencies);
  registerOpportunityTools(server, dependencies);
  registerTaskAndNoteTools(server, dependencies);
  registerListTools(server, dependencies);
  registerSequenceTools(server, dependencies);
  registerLinkedinTools(server, dependencies);
  registerUniboxTools(server, dependencies);

  if (dependencies.enableAdvanced) {
    registerAdvancedReadTools(server, dependencies);
  }
};
