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
import { combineFilters } from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';
import {
  buildLinkedinActionEventDateFilter,
  buildLinkedinActionSearchFilter,
  buildLinkedinConnectionSearchFilter,
  buildLinkedinInvitationSearchFilter,
  buildLinkedinMessageSearchFilter,
  emptyLinkedinSearchResult,
  resolveLinkedinContactThreadIds,
} from './linkedin-search.utils.js';

const LINKEDIN_ACTIVITY_TYPES = [
  'MESSAGES',
  'CONNECTIONS',
  'INVITATIONS',
  'ACTIONS',
] as const;

const activitySearchSchema = z.object({
  types: z
    .array(z.enum(LINKEDIN_ACTIVITY_TYPES))
    .min(1)
    .default([...LINKEDIN_ACTIVITY_TYPES])
    .describe('LinkedIn record families to search.'),
  search: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe('Case-insensitive text in each record family’s text fields.'),
  contact: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe('Contact name, handle, LinkedIn URN, or profile URL text.'),
  person_id: recordIdSchema.optional(),
  direction: z
    .enum(['INBOUND', 'OUTBOUND'])
    .optional()
    .describe(
      'Maps to message INBOUND/OUTBOUND and invitation RECEIVED/SENT. Connections have no direction; actions are outbound.',
    ),
  action_type: z
    .enum([
      'SEND_CONNECTION_REQUEST',
      'SEND_MESSAGE',
      'WITHDRAW_CONNECTION_REQUEST',
    ])
    .optional(),
  action_status: z
    .enum([
      'SCHEDULED',
      'CLAIMED',
      'COMPLETED',
      'SKIPPED',
      'FAILED',
      'CANCELLED',
    ])
    .optional(),
  date_from: z
    .string()
    .datetime()
    .optional()
    .describe('Inclusive ISO 8601 lower event-time bound.'),
  date_to: z
    .string()
    .datetime()
    .optional()
    .describe('Inclusive ISO 8601 upper event-time bound.'),
  limit_per_type: listLimitSchema.describe(
    'Maximum records returned for each selected family.',
  ),
  response_format: responseFormatSchema,
});

const skippedActivityResult = (reason: string) => ({
  ...emptyLinkedinSearchResult(),
  skipped: true,
  reason,
});

export const registerLinkedinActivitySearchTool = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_search_linkedin_activity',
    {
      title: 'Search LinkedIn activity',
      description:
        'Searches downloaded LinkedIn messages, established connections, invitation observations, and runner actions together using one contact/direction/time window. Results stay separated by source because their timestamps and meanings differ.',
      inputSchema: activitySearchSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      types,
      search,
      contact,
      person_id,
      direction,
      action_type,
      action_status,
      date_from,
      date_to,
      limit_per_type,
      response_format,
    }) =>
      runTool(async () => {
        const token = requireUserToken(dependencies.client);
        const actionEventDateFilter = buildLinkedinActionEventDateFilter({
          date_from,
          date_to,
        });
        const includesMessages = types.includes('MESSAGES');
        const contactThreadIds = includesMessages
          ? await resolveLinkedinContactThreadIds({
              records,
              contact,
              personId: person_id,
              token,
            })
          : undefined;

        const entries = await Promise.all(
          types.map(async (type) => {
            if (type === 'MESSAGES') {
              const result =
                contactThreadIds?.length === 0
                  ? emptyLinkedinSearchResult()
                  : await records.list({
                      object: STANDARD_OBJECTS.linkedinMessages,
                      filter: buildLinkedinMessageSearchFilter(
                        {
                          search,
                          direction,
                          date_from,
                          date_to,
                        },
                        contactThreadIds,
                      ),
                      orderBy: 'deliveredAt[DescNullsLast]',
                      limit: limit_per_type,
                      depth: 0,
                      token,
                    });

              return ['messages', result] as const;
            }

            if (type === 'CONNECTIONS') {
              return [
                'connections',
                await records.list({
                  object: STANDARD_OBJECTS.linkedinConnections,
                  filter: buildLinkedinConnectionSearchFilter({
                    search,
                    contact,
                    person_id,
                    date_from,
                    date_to,
                  }),
                  orderBy: 'connectedAt[DescNullsLast]',
                  limit: limit_per_type,
                  depth: 0,
                  token,
                }),
              ] as const;
            }

            if (type === 'INVITATIONS') {
              if (person_id !== undefined && contact === undefined) {
                return [
                  'invitations',
                  skippedActivityResult(
                    'Invitation observations have no Twenty person relation. Add contact text or search invitations separately.',
                  ),
                ] as const;
              }

              return [
                'invitations',
                await records.list({
                  object: STANDARD_OBJECTS.linkedinInvitations,
                  filter: buildLinkedinInvitationSearchFilter({
                    search,
                    contact,
                    direction:
                      direction === 'OUTBOUND'
                        ? 'SENT'
                        : direction === 'INBOUND'
                          ? 'RECEIVED'
                          : undefined,
                    date_from,
                    date_to,
                  }),
                  orderBy: 'sentAt[DescNullsLast]',
                  limit: limit_per_type,
                  depth: 0,
                  token,
                }),
              ] as const;
            }

            if (direction === 'INBOUND') {
              return [
                'actions',
                skippedActivityResult(
                  'LinkedIn runner actions are outbound; none match INBOUND.',
                ),
              ] as const;
            }

            return [
              'actions',
              await records.list({
                object: STANDARD_OBJECTS.linkedinActions,
                filter: combineFilters('and', [
                  buildLinkedinActionSearchFilter({
                    search,
                    contact,
                    person_id,
                    type: action_type,
                    status: action_status,
                  }),
                  actionEventDateFilter,
                ]),
                orderBy: 'scheduledAt[DescNullsLast]',
                limit: limit_per_type,
                depth: 0,
                token,
              }),
            ] as const;
          }),
        );

        return {
          date_range: { from: date_from ?? null, to: date_to ?? null },
          direction: direction ?? 'ANY',
          sources: Object.fromEntries(entries),
          definitions: {
            messages: 'Downloaded delivered LinkedIn messages.',
            connections: 'Downloaded established connections; no direction.',
            invitations:
              'Downloaded sent/received observations; not proof of current pending state.',
            actions:
              'Local runner queue/execution records; event time is executedAt when present, otherwise scheduledAt.',
          },
          pagination:
            'Each source paginates independently. Use its dedicated twenty_search_linkedin_* tool with next_cursor to continue.',
        };
      }, response_format),
  );
};
