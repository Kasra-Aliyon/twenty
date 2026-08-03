import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { RecordsService } from '../services/records.service.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';

const UNIBOX_THREADS_QUERY = `
  query TwentyMcpUniboxThreads($input: UniboxThreadsInput!) {
    uniboxThreads(input: $input) {
      totalCount
      threads {
        id
        channel
        subject
        lastMessagePreview
        lastMessageAt
        messageCount
        isRead
        hasCrmContact
        connectedAccountId
        participants {
          displayName
          handle
          avatarUrl
          personId
        }
      }
    }
  }
`;

const UNIBOX_CONTACTS_QUERY = `
  query TwentyMcpUniboxContacts($input: UniboxContactsInput!) {
    uniboxContacts(input: $input) {
      totalCount
      contacts {
        handle
        displayName
        secondaryLabel
        personId
        messageCount
        lastContactedAt
        firstContactedAt
      }
    }
  }
`;

const ADD_CONTACTS_MUTATION = `
  mutation TwentyMcpAddUniboxContacts($input: AddUniboxContactsToCrmInput!) {
    addUniboxContactsToCrm(input: $input) {
      createdPersonCount
      alreadyExistingCount
      personIds
    }
  }
`;

const uniboxToken = (dependencies: ToolDependencies): 'user' =>
  requireUserToken(dependencies.client);

const contactsFilterSchema = z.object({
  search: z.string().max(255).optional(),
  since: z
    .enum(['LIFETIME', 'LAST_YEAR', 'LAST_90_DAYS', 'LAST_30_DAYS'])
    .optional(),
  inCrmFilter: z.enum(['NOT_IN_CRM', 'IN_CRM', 'ALL']).optional(),
  afterLastContactedAt: z.string().datetime().optional(),
  afterHandle: z.string().max(320).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export const registerUniboxTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_unibox_list_threads',
    {
      title: 'List Unibox threads',
      description:
        'Lists email or LinkedIn Unibox threads with CRM/unread/search/date filters. Requires TWENTY_USER_TOKEN.',
      inputSchema: z.object({
        channel: z.enum(['EMAIL', 'LINKEDIN']).default('EMAIL'),
        folder: z.enum(['INBOX', 'SENT', 'DRAFT']).default('INBOX'),
        connected_account_ids: z.array(z.string()).optional(),
        record_list_id: z.string().optional(),
        only_crm_contacts: z.boolean().default(false),
        unread_only: z.boolean().default(false),
        search: z.string().max(255).optional(),
        date_from: z.string().datetime().optional(),
        after_last_message_at: z.string().datetime().optional(),
        after_thread_id: z.string().optional(),
        page: z.number().int().positive().default(1),
        page_size: z.number().int().min(1).max(100).default(20),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      channel,
      folder,
      connected_account_ids,
      record_list_id,
      only_crm_contacts,
      unread_only,
      search,
      date_from,
      after_last_message_at,
      after_thread_id,
      page,
      page_size,
      response_format,
    }) =>
      runTool(
        () =>
          dependencies.client.graphql<unknown>(
            UNIBOX_THREADS_QUERY,
            {
              input: {
                channel,
                folder,
                ...(connected_account_ids === undefined
                  ? {}
                  : { connectedAccountIds: connected_account_ids }),
                ...(record_list_id === undefined
                  ? {}
                  : { recordListId: record_list_id }),
                onlyCrmContacts: only_crm_contacts,
                unreadOnly: unread_only,
                ...(search === undefined ? {} : { search }),
                ...(date_from === undefined ? {} : { dateFrom: date_from }),
                ...(after_last_message_at === undefined
                  ? {}
                  : { afterLastMessageAt: after_last_message_at }),
                ...(after_thread_id === undefined
                  ? {}
                  : { afterThreadId: after_thread_id }),
                page,
                pageSize: page_size,
              },
            },
            { token: uniboxToken(dependencies) },
          ),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_unibox_get_thread',
    {
      title: 'Get an Unibox thread',
      description:
        'Gets an email or LinkedIn thread and nested messages from the corresponding record object.',
      inputSchema: z.object({
        channel: z.enum(['EMAIL', 'LINKEDIN']),
        thread_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ channel, thread_id, response_format }) =>
      runTool(
        () =>
          records.get({
            object:
              channel === 'LINKEDIN'
                ? STANDARD_OBJECTS.linkedinMessageThreads
                : STANDARD_OBJECTS.messageThreads,
            id: thread_id,
            depth: 1,
            token: uniboxToken(dependencies),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_unibox_list_contacts',
    {
      title: 'List Unibox contacts',
      description:
        'Lists inbox contacts with CRM status and recent-contact filters.',
      inputSchema: contactsFilterSchema.extend({
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format, ...input }) =>
      runTool(
        () =>
          dependencies.client.graphql<unknown>(
            UNIBOX_CONTACTS_QUERY,
            { input },
            { token: uniboxToken(dependencies) },
          ),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_unibox_add_contacts_to_crm',
    {
      title: 'Add Unibox contacts to CRM',
      description:
        'Bulk-creates CRM people from selected handles or an Unibox contact filter. Confirm the selection first.',
      inputSchema: z
        .object({
          handles: z.array(z.string().max(320)).min(1).max(100).optional(),
          filter: contactsFilterSchema.optional(),
          excluded_handles: z.array(z.string().max(320)).max(100).optional(),
          record_list_id: z.string().optional(),
          confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
          response_format: responseFormatSchema,
        })
        .refine(
          (value) => value.handles !== undefined || value.filter !== undefined,
          { message: 'Provide handles or filter.' },
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      handles,
      filter,
      excluded_handles,
      record_list_id,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Contacts were not added: confirm the selected handles/filter first.',
          );
        }

        return dependencies.client.graphql<unknown>(
          ADD_CONTACTS_MUTATION,
          {
            input: {
              ...(handles === undefined ? {} : { handles }),
              ...(filter === undefined ? {} : { filter }),
              ...(excluded_handles === undefined
                ? {}
                : { excludedHandles: excluded_handles }),
              ...(record_list_id === undefined
                ? {}
                : { recordListId: record_list_id }),
            },
          },
          { token: uniboxToken(dependencies) },
        );
      }, response_format),
  );
};

export const uniboxToolsTesting = { uniboxToken };
