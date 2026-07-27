import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ToolDependencies } from '../types.js';
import { registerActivityTimelineTools } from './activity-timeline.tools.js';
import { registerAdvancedReadTools } from './advanced-read.tools.js';
import { registerApolloEnrichmentTools } from './apollo-enrichment.tools.js';
import { registerCompanyTools } from './companies.tools.js';
import { registerDashboardTools } from './dashboards.tools.js';
import { registerDiscoveryTools } from './discovery.tools.js';
import { registerEmailTools } from './email.tools.js';
import { registerLinkedinTools } from './linkedin.tools.js';
import { registerListTools } from './lists.tools.js';
import { registerOpportunityTools } from './opportunities.tools.js';
import { registerPeopleTools } from './people.tools.js';
import { registerRecordTools } from './records.tools.js';
import { registerSequenceTools } from './sequences.tools.js';
import { registerTaskAndNoteTools } from './tasks-notes.tools.js';
import { registerUniboxTools } from './unibox.tools.js';
import { registerViewTools } from './views.tools.js';

export const registerAllTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  registerDiscoveryTools(server, dependencies);
  registerRecordTools(server, dependencies);
  registerPeopleTools(server, dependencies);
  registerCompanyTools(server, dependencies);
  registerApolloEnrichmentTools(server, dependencies);
  registerDashboardTools(server, dependencies);
  registerOpportunityTools(server, dependencies);
  registerTaskAndNoteTools(server, dependencies);
  registerActivityTimelineTools(server, dependencies);
  registerListTools(server, dependencies);
  registerSequenceTools(server, dependencies);
  registerEmailTools(server, dependencies);
  registerLinkedinTools(server, dependencies);
  registerUniboxTools(server, dependencies);
  registerViewTools(server, dependencies);

  if (dependencies.enableAdvanced) {
    registerAdvancedReadTools(server, dependencies);
  }
};
