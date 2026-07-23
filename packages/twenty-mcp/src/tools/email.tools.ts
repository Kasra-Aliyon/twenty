import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
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

const SEND_EMAIL_MUTATION = `
  mutation TwentyMcpSendEmail($input: SendEmailInput!) {
    sendEmail(input: $input) {
      success
      error
    }
  }
`;

const UNSUBSCRIBE_TOPICS_QUERY = `
  query TwentyMcpUnsubscribeTopics {
    unsubscribeTopics {
      id
      name
      description
      visibility
    }
  }
`;

const PREVIEW_CAMPAIGN_QUERY = `
  query TwentyMcpPreviewCampaign(
    $input: PreviewMessageCampaignAudienceInput!
  ) {
    previewMessageCampaignAudience(input: $input) {
      totalMembers
      withoutEmail
      duplicateEmails
      globallyUnsubscribed
      topicUnsubscribed
      sendable
    }
  }
`;

const SEND_CAMPAIGN_MUTATION = `
  mutation TwentyMcpSendCampaign($input: SendMessageCampaignInput!) {
    sendMessageCampaign(input: $input) {
      campaignId
      queuedCount
      skipped {
        noEmail
        deduped
        overCap
      }
    }
  }
`;

const emailAttachmentSchema = z.object({
  id: z.string().min(1).describe('Previously uploaded email attachment ID.'),
  name: z.string().min(1),
});

const emailContentSchema = z.object({
  connected_account_id: recordIdSchema,
  to: z.string().min(1).describe('Comma-separated primary recipients.'),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  body: z.string().describe('Email body as HTML.'),
  files: z.array(emailAttachmentSchema).max(20).optional(),
});

type SendEmailInput = {
  connectedAccountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  files?: Array<{ id: string; name: string }>;
};

type SendEmailOutput = {
  success: boolean;
  error?: string | null;
};

const sendEmail = async (
  dependencies: ToolDependencies,
  input: SendEmailInput,
): Promise<SendEmailOutput> => {
  const result = await dependencies.client.graphql<{
    sendEmail: SendEmailOutput;
  }>(
    SEND_EMAIL_MUTATION,
    { input },
    {
      endpoint: 'metadata',
      token: requireUserToken(dependencies.client),
    },
  );

  return result.sendEmail;
};

const draftData = ({
  bcc,
  body,
  cc,
  connectedAccountId,
  inReplyTo,
  messageThreadId,
  subject,
  to,
}: {
  bcc?: string;
  body?: string;
  cc?: string;
  connectedAccountId?: string;
  inReplyTo?: string | null;
  messageThreadId?: string | null;
  subject?: string;
  to?: string;
}): Record<string, unknown> =>
  compactRecord([
    ['subject', subject],
    ['body', body],
    ['to', to],
    ['cc', cc],
    ['bcc', bcc],
    ['inReplyTo', inReplyTo],
    ['connectedAccountId', connectedAccountId],
    ['messageThreadId', messageThreadId],
  ]);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Twenty returned an invalid email draft.');
  }

  return value as Record<string, unknown>;
};

const requiredDraftString = (
  draft: Record<string, unknown>,
  field: string,
): string => {
  const value = draft[field];

  if (typeof value !== 'string') {
    throw new Error(`Email draft is missing ${field}.`);
  }

  return value;
};

export const registerEmailTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_send_email',
    {
      title: 'Send an email',
      description:
        'Sends a one-off email through a user-owned connected account. Requires TWENTY_USER_TOKEN and confirmation of sender, recipients, subject, and body.',
      inputSchema: emailContentSchema.extend({
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
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
      connected_account_id,
      to,
      cc,
      bcc,
      subject,
      body,
      files,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Email not sent: confirm the sender, recipients, subject, body, and attachments first.',
          );
        }

        return sendEmail(dependencies, {
          connectedAccountId: connected_account_id,
          to,
          cc,
          bcc,
          subject,
          body,
          files,
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_reply_to_email',
    {
      title: 'Reply to an email',
      description:
        'Sends an email reply anchored to the original RFC Message-ID. Use the parent message headerMessageId as in_reply_to.',
      inputSchema: emailContentSchema.extend({
        in_reply_to: z.string().min(1),
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
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
      connected_account_id,
      to,
      cc,
      bcc,
      subject,
      body,
      files,
      in_reply_to,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Reply not sent: confirm the sender, recipients, parent message, subject, and body first.',
          );
        }

        return sendEmail(dependencies, {
          connectedAccountId: connected_account_id,
          to,
          cc,
          bcc,
          subject,
          body,
          files,
          inReplyTo: in_reply_to,
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_list_email_drafts',
    {
      title: 'List email drafts',
      description:
        'Lists drafts owned by the authenticated user, optionally narrowed to a thread or connected account.',
      inputSchema: z.object({
        message_thread_id: recordIdSchema.optional(),
        connected_account_id: recordIdSchema.optional(),
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      message_thread_id,
      connected_account_id,
      limit,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.messageDrafts,
            filter: combineFilters('and', [
              message_thread_id === undefined
                ? undefined
                : filterCondition('messageThreadId', 'eq', message_thread_id),
              connected_account_id === undefined
                ? undefined
                : filterCondition(
                    'connectedAccountId',
                    'eq',
                    connected_account_id,
                  ),
            ]),
            orderBy: 'lastEditedAt[DescNullsLast]',
            limit,
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_create_email_draft',
    {
      title: 'Create an email draft',
      description:
        'Creates a user-owned email draft. Draft creation does not send external email.',
      inputSchema: emailContentSchema
        .omit({ files: true })
        .partial({ to: true, subject: true, body: true })
        .extend({
          in_reply_to: z.string().nullable().optional(),
          message_thread_id: recordIdSchema.nullable().optional(),
          response_format: responseFormatSchema,
        }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({
      connected_account_id,
      to,
      cc,
      bcc,
      subject,
      body,
      in_reply_to,
      message_thread_id,
      response_format,
    }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.messageDrafts,
            data: draftData({
              connectedAccountId: connected_account_id,
              to: to ?? '',
              cc: cc ?? '',
              bcc: bcc ?? '',
              subject: subject ?? '',
              body: body ?? '',
              inReplyTo: in_reply_to,
              messageThreadId: message_thread_id,
            }),
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_email_draft',
    {
      title: 'Update an email draft',
      description:
        'Updates selected fields of a draft owned by the authenticated user.',
      inputSchema: emailContentSchema
        .omit({ files: true })
        .partial()
        .extend({
          draft_id: recordIdSchema,
          in_reply_to: z.string().nullable().optional(),
          message_thread_id: recordIdSchema.nullable().optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ draft_id: _draftId, response_format: _format, ...updates }) =>
            Object.values(updates).some((value) => value !== undefined),
          'Provide at least one draft update.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({
      draft_id,
      connected_account_id,
      to,
      cc,
      bcc,
      subject,
      body,
      in_reply_to,
      message_thread_id,
      response_format,
    }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.messageDrafts,
            id: draft_id,
            data: draftData({
              connectedAccountId: connected_account_id,
              to,
              cc,
              bcc,
              subject,
              body,
              inReplyTo: in_reply_to,
              messageThreadId: message_thread_id,
            }),
            token: requireUserToken(dependencies.client),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_delete_email_draft',
    {
      title: 'Delete an email draft',
      description:
        'Moves a user-owned email draft to trash. This does not send it.',
      inputSchema: z.object({
        draft_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ draft_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Draft deletion not performed: confirm must be true after explicit user confirmation.',
          );
        }

        return records.softDelete(
          STANDARD_OBJECTS.messageDrafts,
          draft_id,
          requireUserToken(dependencies.client),
        );
      }, response_format),
  );

  server.registerTool(
    'twenty_send_email_draft',
    {
      title: 'Send an email draft',
      description:
        'Sends a saved draft, then moves the draft to trash only after Twenty reports a successful send.',
      inputSchema: z.object({
        draft_id: recordIdSchema,
        files: z.array(emailAttachmentSchema).max(20).optional(),
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ draft_id, files, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Draft not sent: review and confirm its sender, recipients, subject, body, and attachments first.',
          );
        }

        const token = requireUserToken(dependencies.client);
        const draft = asRecord(
          await records.get({
            object: STANDARD_OBJECTS.messageDrafts,
            id: draft_id,
            token,
          }),
        );
        const result = await sendEmail(dependencies, {
          connectedAccountId: requiredDraftString(draft, 'connectedAccountId'),
          to: requiredDraftString(draft, 'to'),
          cc: requiredDraftString(draft, 'cc'),
          bcc: requiredDraftString(draft, 'bcc'),
          subject: requiredDraftString(draft, 'subject'),
          body: requiredDraftString(draft, 'body'),
          ...(typeof draft.inReplyTo === 'string'
            ? { inReplyTo: draft.inReplyTo }
            : {}),
          files,
        });

        if (!result.success) {
          return { send: result, draft_deleted: false };
        }

        try {
          const deletedDraft = await records.softDelete(
            STANDARD_OBJECTS.messageDrafts,
            draft_id,
            token,
          );

          return { send: result, draft_deleted: true, draft: deletedDraft };
        } catch (error) {
          return {
            send: result,
            draft_deleted: false,
            warning:
              'The email was sent successfully, but the saved draft could not be moved to trash. Do not resend it.',
            draft_delete_error:
              error instanceof Error ? error.message : String(error),
          };
        }
      }, response_format),
  );

  server.registerTool(
    'twenty_list_unsubscribe_topics',
    {
      title: 'List unsubscribe topics',
      description:
        'Lists workspace unsubscribe topics that can be attached to an email campaign.',
      inputSchema: z.object({
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          unsubscribeTopics: unknown[];
        }>(
          UNSUBSCRIBE_TOPICS_QUERY,
          {},
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.unsubscribeTopics;
      }, response_format),
  );

  server.registerTool(
    'twenty_preview_email_campaign',
    {
      title: 'Preview an email campaign audience',
      description:
        'Returns total, missing-email, duplicate, unsubscribed, and sendable counts for a record-list campaign without sending.',
      inputSchema: z.object({
        list_id: recordIdSchema,
        unsubscribe_topic_id: recordIdSchema.optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ list_id, unsubscribe_topic_id, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          previewMessageCampaignAudience: unknown;
        }>(
          PREVIEW_CAMPAIGN_QUERY,
          {
            input: {
              listId: list_id,
              ...(unsubscribe_topic_id === undefined
                ? {}
                : { unsubscribeTopicId: unsubscribe_topic_id }),
            },
          },
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.previewMessageCampaignAudience;
      }, response_format),
  );

  server.registerTool(
    'twenty_send_email_campaign',
    {
      title: 'Send an email campaign',
      description:
        'Queues a campaign to the sendable members of a record list. Preview the audience first and confirm the list, sender, topic, subject, and body.',
      inputSchema: z.object({
        list_id: recordIdSchema,
        from_address: z.string().min(1),
        unsubscribe_topic_id: recordIdSchema.optional(),
        subject: z.string(),
        body: z.string().describe('Campaign body as HTML.'),
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
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
      list_id,
      from_address,
      unsubscribe_topic_id,
      subject,
      body,
      confirm,
      response_format,
    }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Campaign not sent: preview and confirm the audience, sender, unsubscribe topic, subject, and body first.',
          );
        }

        const result = await dependencies.client.graphql<{
          sendMessageCampaign: unknown;
        }>(
          SEND_CAMPAIGN_MUTATION,
          {
            input: {
              listId: list_id,
              fromAddress: from_address,
              subject,
              body,
              ...(unsubscribe_topic_id === undefined
                ? {}
                : { unsubscribeTopicId: unsubscribe_topic_id }),
            },
          },
          {
            endpoint: 'metadata',
            token: requireUserToken(dependencies.client),
          },
        );

        return result.sendMessageCampaign;
      }, response_format),
  );
};

export const emailToolsTesting = {
  draftData,
  requiredDraftString,
};
