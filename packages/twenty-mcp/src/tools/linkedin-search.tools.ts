import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { RecordsService } from '../services/records.service.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';
import {
  buildLinkedinActionSearchFilter,
  buildLinkedinConnectionSearchFilter,
  buildLinkedinInvitationSearchFilter,
  buildLinkedinMessageSearchFilter,
  buildLinkedinParticipantSearchFilter,
  buildLinkedinThreadSearchFilter,
  emptyLinkedinSearchResult,
  resolveLinkedinContactThreadIds,
} from './linkedin-search.utils.js';

const linkedinDepthSchema = z
  .number()
  .int()
  .min(0)
  .max(1)
  .default(0)
  .describe('LinkedIn relation traversal depth. Twenty REST accepts 0 or 1.');

const searchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .describe('Case-insensitive text contained in the searchable fields.');

const contactSearchSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .describe('Contact name, LinkedIn handle, URN, or profile URL text.');

const dateFromSchema = z
  .string()
  .datetime()
  .optional()
  .describe('Inclusive ISO 8601 lower time bound.');

const dateToSchema = z
  .string()
  .datetime()
  .optional()
  .describe('Inclusive ISO 8601 upper time bound.');

const cursorSearchShape = {
  limit: listLimitSchema,
  depth: linkedinDepthSchema,
  starting_after: z
    .string()
    .optional()
    .describe('Use the previous response next_cursor to fetch the next page.'),
  ending_before: z.string().optional(),
  response_format: responseFormatSchema,
};

const linkedinMessageSearchSchema = z.object({
  search: searchTextSchema.describe(
    'Case-insensitive text contained in message body or sender name.',
  ),
  contact: contactSearchSchema,
  person_id: recordIdSchema
    .optional()
    .describe('Twenty person matched to a non-self thread participant.'),
  thread_id: recordIdSchema.optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  date_from: dateFromSchema.describe(
    'Inclusive lower bound for message deliveredAt.',
  ),
  date_to: dateToSchema.describe(
    'Inclusive upper bound for message deliveredAt.',
  ),
  ...cursorSearchShape,
});

const linkedinThreadSearchSchema = z.object({
  search: searchTextSchema.describe(
    'Case-insensitive text contained in thread name or last-message preview.',
  ),
  contact: contactSearchSchema.describe(
    'Contact name text contained in the thread name.',
  ),
  date_from: dateFromSchema.describe(
    'Threads whose recorded conversation span ends on or after this time.',
  ),
  date_to: dateToSchema.describe(
    'Threads whose recorded conversation span starts on or before this time.',
  ),
  ...cursorSearchShape,
});

const linkedinParticipantSearchSchema = z.object({
  search: searchTextSchema.describe(
    'Case-insensitive name, handle, headline, LinkedIn ID/URN, or profile URL text.',
  ),
  person_id: recordIdSchema.optional(),
  thread_id: recordIdSchema.optional(),
  is_self: z.boolean().optional(),
  ...cursorSearchShape,
});

const linkedinConnectionSearchSchema = z.object({
  search: searchTextSchema.describe(
    'Case-insensitive name, handle, headline, LinkedIn URN, or profile URL text.',
  ),
  contact: contactSearchSchema,
  person_id: recordIdSchema.optional(),
  date_from: dateFromSchema.describe(
    'Inclusive lower bound for connection connectedAt.',
  ),
  date_to: dateToSchema.describe(
    'Inclusive upper bound for connection connectedAt.',
  ),
  ...cursorSearchShape,
});

const linkedinInvitationSearchSchema = z.object({
  search: searchTextSchema.describe(
    'Case-insensitive contact name, handle, headline, or invitation-note text.',
  ),
  contact: contactSearchSchema,
  direction: z.enum(['SENT', 'RECEIVED']).optional(),
  date_from: dateFromSchema.describe(
    'Inclusive lower bound for invitation sentAt.',
  ),
  date_to: dateToSchema.describe(
    'Inclusive upper bound for invitation sentAt.',
  ),
  ...cursorSearchShape,
});

const linkedinActionSearchSchema = z.object({
  search: searchTextSchema.describe(
    'Case-insensitive profile URL, note/message text, or error text.',
  ),
  contact: contactSearchSchema.describe(
    'Case-insensitive LinkedIn profile URL text for the action target. Use person_id when available.',
  ),
  person_id: recordIdSchema.optional(),
  type: z
    .enum([
      'SEND_CONNECTION_REQUEST',
      'SEND_MESSAGE',
      'WITHDRAW_CONNECTION_REQUEST',
    ])
    .optional(),
  status: z
    .enum([
      'SCHEDULED',
      'CLAIMED',
      'COMPLETED',
      'SKIPPED',
      'FAILED',
      'CANCELLED',
    ])
    .optional(),
  connection_state: z
    .enum(['UNKNOWN', 'NOT_CONNECTED', 'PENDING', 'CONNECTED', 'WITHDRAWN'])
    .optional(),
  date_field: z
    .enum(['scheduled', 'executed', 'created'])
    .default('scheduled')
    .describe('Action timestamp to constrain and order.'),
  date_from: dateFromSchema,
  date_to: dateToSchema,
  ...cursorSearchShape,
});

export const registerLinkedinSearchTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_search_linkedin_messages',
    {
      title: 'Search LinkedIn messages',
      description:
        'Searches downloaded LinkedIn message bodies by text, contact or matched Twenty person, direction, thread, and delivered-at range. Results are newest-first and cursor-paginated.',
      inputSchema: linkedinMessageSearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      contact,
      person_id,
      thread_id,
      direction,
      date_from,
      date_to,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) =>
      runTool(async () => {
        const token = requireUserToken(dependencies.client);
        const contactThreadIds = await resolveLinkedinContactThreadIds({
          records,
          contact,
          personId: person_id,
          token,
        });

        if (
          contactThreadIds?.length === 0 ||
          (thread_id !== undefined &&
            contactThreadIds !== undefined &&
            !contactThreadIds.includes(thread_id))
        ) {
          return emptyLinkedinSearchResult();
        }

        return records.list({
          object: STANDARD_OBJECTS.linkedinMessages,
          filter: buildLinkedinMessageSearchFilter(
            { search, direction, thread_id, date_from, date_to },
            contactThreadIds,
          ),
          orderBy: 'deliveredAt[DescNullsLast]',
          limit,
          depth,
          startingAfter: starting_after,
          endingBefore: ending_before,
          token,
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_search_linkedin_threads',
    {
      title: 'Search LinkedIn threads',
      description:
        'Searches downloaded LinkedIn threads by contact/thread text and conversation-span time range. Use message search when exact message delivery within the window matters.',
      inputSchema: linkedinThreadSearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      contact,
      date_from,
      date_to,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinMessageThreads,
            filter: buildLinkedinThreadSearchFilter({
              search,
              contact,
              date_from,
              date_to,
            }),
            orderBy: 'lastMessageTime[DescNullsLast]',
            limit,
            depth,
            startingAfter: starting_after,
            endingBefore: ending_before,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_search_linkedin_participants',
    {
      title: 'Search LinkedIn thread participants',
      description:
        'Searches downloaded LinkedIn conversation participants by contact identity, matched Twenty person, thread, and self/non-self status.',
      inputSchema: linkedinParticipantSearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      person_id,
      thread_id,
      is_self,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinThreadParticipants,
            filter: buildLinkedinParticipantSearchFilter({
              search,
              person_id,
              thread_id,
              is_self,
            }),
            orderBy: 'name[AscNullsLast]',
            limit,
            depth,
            startingAfter: starting_after,
            endingBefore: ending_before,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_search_linkedin_connections',
    {
      title: 'Search LinkedIn connections',
      description:
        'Searches downloaded established LinkedIn connections by contact identity, matched Twenty person, and connected-at range.',
      inputSchema: linkedinConnectionSearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      contact,
      person_id,
      date_from,
      date_to,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinConnections,
            filter: buildLinkedinConnectionSearchFilter({
              search,
              contact,
              person_id,
              date_from,
              date_to,
            }),
            orderBy: 'connectedAt[DescNullsLast]',
            limit,
            depth,
            startingAfter: starting_after,
            endingBefore: ending_before,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_search_linkedin_invitations',
    {
      title: 'Search LinkedIn invitations',
      description:
        'Searches downloaded sent/received LinkedIn invitation observations by contact or note text and sent-at range. Observations do not prove an invitation is still pending.',
      inputSchema: linkedinInvitationSearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      contact,
      direction,
      date_from,
      date_to,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinInvitations,
            filter: buildLinkedinInvitationSearchFilter({
              search,
              contact,
              direction,
              date_from,
              date_to,
            }),
            orderBy: 'sentAt[DescNullsLast]',
            limit,
            depth,
            startingAfter: starting_after,
            endingBefore: ending_before,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_search_linkedin_actions',
    {
      title: 'Search LinkedIn actions',
      description:
        'Searches local LinkedIn runner actions by message/note, profile URL, error, person, type, status, observed connection state, and scheduled/executed/created time.',
      inputSchema: linkedinActionSearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      contact,
      person_id,
      type,
      status,
      connection_state,
      date_field,
      date_from,
      date_to,
      limit,
      depth,
      starting_after,
      ending_before,
      response_format,
    }) => {
      const orderField =
        date_field === 'created'
          ? 'createdAt'
          : date_field === 'executed'
            ? 'executedAt'
            : 'scheduledAt';

      return runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinActions,
            filter: buildLinkedinActionSearchFilter({
              search,
              contact,
              person_id,
              type,
              status,
              connection_state,
              date_field,
              date_from,
              date_to,
            }),
            orderBy: `${orderField}[DescNullsLast]`,
            limit,
            depth,
            startingAfter: starting_after,
            endingBefore: ending_before,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      );
    },
  );
};
