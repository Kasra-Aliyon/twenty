import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { LINKEDIN_ACTION_TYPES, STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { combineFilters, filterCondition } from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';
import { compactRecord } from './tool-data-builders.js';

const linkedinDepthSchema = z
  .number()
  .int()
  .min(0)
  .max(1)
  .describe('LinkedIn relation traversal depth. Twenty REST accepts 0 or 1.');

const linkedinActionBaseSchema = z.object({
  person_id: recordIdSchema,
  linkedin_url: z.url(),
  scheduled_at: z.string().datetime().optional(),
  confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
  response_format: responseFormatSchema,
});

const createLinkedinAction = ({
  personId,
  linkedinUrl,
  type,
  noteText = '',
  scheduledAt,
}: {
  personId: string;
  linkedinUrl: string;
  type: string;
  noteText?: string;
  scheduledAt?: string;
}): Record<string, unknown> =>
  compactRecord([
    ['personId', personId],
    ['linkedinUrl', linkedinUrl],
    ['type', type],
    ['status', 'SCHEDULED'],
    ['noteText', noteText],
    ['scheduledAt', scheduledAt ?? new Date().toISOString()],
  ]);

const addRecipientReadStatus = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    ...record,
    recipientReadStatus:
      typeof record.recipientReadAt === 'string' ? 'READ_CONFIRMED' : 'UNKNOWN',
  };
};

export const registerLinkedinTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_list_linkedin_connections',
    {
      title: 'List LinkedIn connections',
      description:
        'Lists synced LinkedIn connections with optional person filter.',
      inputSchema: z.object({
        person_id: z.string().optional(),
        limit: listLimitSchema,
        depth: linkedinDepthSchema.default(0),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ person_id, limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinConnections,
            filter:
              person_id === undefined
                ? undefined
                : filterCondition('personId', 'eq', person_id),
            limit,
            depth,
            orderBy: 'connectedAt[DescNullsLast]',
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_list_linkedin_invitations',
    {
      title: 'List harvested LinkedIn invitations',
      description:
        'Lists synced LinkedIn invitation observations newest-first, optionally filtered by direction. Invitation records are historical observations and do not by themselves prove that an invitation is still pending.',
      inputSchema: z.object({
        direction: z.enum(['SENT', 'RECEIVED']).optional(),
        limit: listLimitSchema,
        depth: linkedinDepthSchema.default(0),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ direction, limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinInvitations,
            filter:
              direction === undefined
                ? undefined
                : filterCondition('direction', 'eq', direction),
            limit,
            depth,
            orderBy: 'sentAt[DescNullsLast]',
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_linkedin_connection',
    {
      title: 'Get a LinkedIn connection',
      description: 'Gets one LinkedIn connection record.',
      inputSchema: z.object({
        connection_id: recordIdSchema,
        depth: linkedinDepthSchema.default(0),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ connection_id, depth, response_format }) =>
      runTool(
        () =>
          records.get({
            object: STANDARD_OBJECTS.linkedinConnections,
            id: connection_id,
            depth,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_list_linkedin_threads',
    {
      title: 'List LinkedIn message threads',
      description: 'Lists synced LinkedIn message threads.',
      inputSchema: z.object({
        limit: listLimitSchema,
        depth: linkedinDepthSchema.default(0),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinMessageThreads,
            limit,
            depth,
            orderBy: 'lastMessageTime[DescNullsLast]',
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_linkedin_thread',
    {
      title: 'Get a LinkedIn message thread',
      description:
        'Gets a LinkedIn thread with participants and messages through relation depth.',
      inputSchema: z.object({
        thread_id: recordIdSchema,
        depth: linkedinDepthSchema.default(1),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ thread_id, depth, response_format }) =>
      runTool(
        () =>
          records.get({
            object: STANDARD_OBJECTS.linkedinMessageThreads,
            id: thread_id,
            depth,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_list_linkedin_message_read_receipts',
    {
      title: 'List LinkedIn message read receipts',
      description:
        'Lists outbound LinkedIn messages with recipient read status. READ_CONFIRMED has a positive LinkedIn receipt; UNKNOWN never means unread because LinkedIn may withhold receipts.',
      inputSchema: z.object({
        thread_id: recordIdSchema.optional(),
        status: z.enum(['ALL', 'READ_CONFIRMED', 'UNKNOWN']).default('ALL'),
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ thread_id, status, limit, response_format }) =>
      runTool(async () => {
        const result = await records.list({
          object: STANDARD_OBJECTS.linkedinMessages,
          filter: combineFilters('and', [
            filterCondition('direction', 'eq', 'OUTBOUND'),
            thread_id === undefined
              ? undefined
              : filterCondition('threadId', 'eq', thread_id),
            status === 'ALL'
              ? undefined
              : status === 'READ_CONFIRMED'
                ? 'recipientReadAt[is]:NOT_NULL'
                : filterCondition('recipientReadAt', 'is', null),
          ]),
          orderBy: 'deliveredAt[DescNullsLast]',
          limit,
          depth: 0,
          fields: [
            'messageId',
            'body',
            'deliveredAt',
            'recipientReadAt',
            'direction',
            'threadId',
          ],
          token: requireUserToken(dependencies.client),
        });

        return {
          ...result,
          items: result.items.map(addRecipientReadStatus),
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_send_linkedin_message',
    {
      title: 'Queue a LinkedIn message',
      description:
        'Queues an asynchronous SEND_MESSAGE LinkedIn action. Confirm the recipient, profile URL, and exact message before calling.',
      inputSchema: linkedinActionBaseSchema.extend({
        message: z.string().min(1).max(2000),
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      person_id,
      linkedin_url,
      scheduled_at,
      message,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'LinkedIn message not queued: confirm recipient and message first.',
          );
        }

        return records.create({
          object: STANDARD_OBJECTS.linkedinActions,
          data: createLinkedinAction({
            personId: person_id,
            linkedinUrl: linkedin_url,
            type: LINKEDIN_ACTION_TYPES.sendMessage,
            noteText: message,
            scheduledAt: scheduled_at,
          }),
          token: requireUserToken(dependencies.client),
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_send_linkedin_invitation',
    {
      title: 'Queue a LinkedIn invitation',
      description:
        'Queues an asynchronous SEND_CONNECTION_REQUEST action. Confirm recipient, URL, and note first.',
      inputSchema: linkedinActionBaseSchema.extend({
        note: z.string().max(200).default(''),
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      person_id,
      linkedin_url,
      scheduled_at,
      note,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'LinkedIn invitation not queued: confirm recipient and note first.',
          );
        }

        return records.create({
          object: STANDARD_OBJECTS.linkedinActions,
          data: createLinkedinAction({
            personId: person_id,
            linkedinUrl: linkedin_url,
            type: LINKEDIN_ACTION_TYPES.sendConnectionRequest,
            noteText: note,
            scheduledAt: scheduled_at,
          }),
          token: requireUserToken(dependencies.client),
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_withdraw_linkedin_invitation',
    {
      title: 'Queue LinkedIn invitation withdrawal',
      description:
        'Queues an asynchronous WITHDRAW_CONNECTION_REQUEST action. Confirm the recipient and profile URL first.',
      inputSchema: linkedinActionBaseSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      person_id,
      linkedin_url,
      scheduled_at,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'LinkedIn invitation withdrawal not queued: confirm recipient first.',
          );
        }

        return records.create({
          object: STANDARD_OBJECTS.linkedinActions,
          data: createLinkedinAction({
            personId: person_id,
            linkedinUrl: linkedin_url,
            type: LINKEDIN_ACTION_TYPES.withdrawConnectionRequest,
            scheduledAt: scheduled_at,
          }),
          token: requireUserToken(dependencies.client),
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_list_linkedin_actions',
    {
      title: 'List LinkedIn actions',
      description:
        'Lists queued, claimed, completed, skipped, failed, or cancelled LinkedIn actions and their errors.',
      inputSchema: z.object({
        person_id: z.string().optional(),
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
        limit: listLimitSchema,
        depth: linkedinDepthSchema.default(0),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ person_id, status, limit, depth, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.linkedinActions,
            filter: combineFilters('and', [
              person_id === undefined
                ? undefined
                : filterCondition('personId', 'eq', person_id),
              status === undefined
                ? undefined
                : filterCondition('status', 'eq', status),
            ]),
            orderBy: 'scheduledAt[DescNullsLast]',
            limit,
            depth,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );
};

export const linkedinToolsTesting = { createLinkedinAction };
