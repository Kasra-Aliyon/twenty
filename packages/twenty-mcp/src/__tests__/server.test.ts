import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../server.js';
import type { MetadataService } from '../services/metadata.service.js';
import type { TwentyClient } from '../services/twenty-client.js';

const listToolNames = async (enableAdvanced: boolean): Promise<string[]> => {
  const server = createMcpServer({
    client: {} as TwentyClient,
    metadata: {} as MetadataService,
    enableAdvanced,
  });
  const client = new Client({
    name: 'twenty-mcp-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    const result = await client.listTools();

    return result.tools.map((tool) => tool.name);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe('MCP server registration', () => {
  it('publishes the complete default tool catalog with schemas', async () => {
    const names = await listToolNames(false);

    expect(names).toHaveLength(114);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'twenty_list_objects',
        'twenty_create_record',
        'twenty_get_pipeline',
        'twenty_enrich_people_with_apollo',
        'twenty_enrich_people_phones_with_apollo',
        'twenty_enrich_companies_with_apollo',
        'twenty_list_connected_accounts',
        'twenty_send_email',
        'twenty_send_email_campaign',
        'twenty_create_dashboard',
        'twenty_add_dashboard_widget',
        'twenty_create_view',
        'twenty_resolve_view_query',
        'twenty_get_record_email_timeline',
        'twenty_get_record_calendar_timeline',
        'twenty_get_sequence_capabilities',
        'twenty_list_sequence_steps',
        'twenty_enroll_person_in_sequence',
        'twenty_mark_enrollment_replied',
        'twenty_skip_enrollment_to_next_step',
        'twenty_send_linkedin_message',
        'twenty_list_linkedin_actions',
        'twenty_unibox_list_threads',
      ]),
    );
    expect(names).not.toContain('twenty_destroy_record');
  });

  it('adds opt-in advanced read and permanent-destroy tools', async () => {
    const names = await listToolNames(true);

    expect(names).toHaveLength(118);
    expect(names).toEqual(
      expect.arrayContaining([
        'twenty_destroy_record',
        'twenty_list_attachments',
        'twenty_list_messages',
        'twenty_list_message_threads',
      ]),
    );
  });
});
