import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { RecordsService } from '../services/records.service.js';
import { requireUserToken } from '../services/user-auth.js';
import type { ToolDependencies } from '../types.js';

const EMAIL_TIMELINE_QUERY = `
  query TwentyMcpRecordEmailTimeline(
    $objectNameSingular: String!
    $recordId: UUID!
    $page: Int!
    $pageSize: Int!
  ) {
    getTimelineThreadsFromObjectRecord(
      objectNameSingular: $objectNameSingular
      recordId: $recordId
      page: $page
      pageSize: $pageSize
    ) {
      totalNumberOfThreads
      timelineThreads {
        id
        read
        visibility
        lastMessageReceivedAt
        lastMessageBody
        subject
        numberOfMessagesInThread
        participantCount
        firstParticipant {
          personId
          workspaceMemberId
          firstName
          lastName
          displayName
          avatarUrl
          handle
        }
        lastTwoParticipants {
          personId
          workspaceMemberId
          firstName
          lastName
          displayName
          avatarUrl
          handle
        }
      }
    }
  }
`;

const CALENDAR_TIMELINE_QUERY = `
  query TwentyMcpRecordCalendarTimeline(
    $objectNameSingular: String!
    $recordId: UUID!
    $page: Int!
    $pageSize: Int!
  ) {
    getTimelineCalendarEventsFromObjectRecord(
      objectNameSingular: $objectNameSingular
      recordId: $recordId
      page: $page
      pageSize: $pageSize
    ) {
      totalNumberOfCalendarEvents
      timelineCalendarEvents {
        id
        title
        description
        location
        startsAt
        endsAt
        isFullDay
        visibility
        participants {
          personId
          workspaceMemberId
          firstName
          lastName
          displayName
          avatarUrl
          handle
        }
      }
    }
  }
`;

type TimelineThread = {
  id: string;
  [key: string]: unknown;
};

type EmailTimeline = {
  totalNumberOfThreads: number;
  timelineThreads: TimelineThread[];
};

const objectNameSingularSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/)
  .describe(
    'Exact singular object name from twenty_list_objects, such as person, company, opportunity, or a custom object.',
  );

const timelineInputSchema = z.object({
  object_name_singular: objectNameSingularSchema,
  record_id: recordIdSchema,
  page: z.number().int().positive().default(1),
  page_size: z.number().int().min(1).max(50).default(20),
  response_format: responseFormatSchema,
});

const hydrateTimelineThreads = async (
  records: RecordsService,
  threads: TimelineThread[],
): Promise<Array<Record<string, unknown>>> => {
  const results = await Promise.allSettled(
    threads.map((thread) =>
      records.get({
        object: STANDARD_OBJECTS.messageThreads,
        id: thread.id,
        depth: 2,
        token: 'user',
      }),
    ),
  );

  return threads.map((thread, index) => {
    const result = results[index];

    return {
      ...thread,
      ...(result?.status === 'fulfilled'
        ? { thread: result.value }
        : {
            thread_error:
              result?.reason instanceof Error
                ? result.reason.message
                : String(result?.reason ?? 'Unknown hydration error'),
          }),
    };
  });
};

export const registerActivityTimelineTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_get_record_email_timeline',
    {
      title: 'Get a record email timeline',
      description:
        'Gets user-visible email threads associated with any record, including participants and optionally every nested message body/header needed to inspect or reply.',
      inputSchema: timelineInputSchema.extend({
        include_messages: z.boolean().default(true),
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      object_name_singular,
      record_id,
      page,
      page_size,
      include_messages,
      response_format,
    }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          getTimelineThreadsFromObjectRecord: EmailTimeline;
        }>(
          EMAIL_TIMELINE_QUERY,
          {
            objectNameSingular: object_name_singular,
            recordId: record_id,
            page,
            pageSize: page_size,
          },
          { token: requireUserToken(dependencies.client) },
        );
        const timeline = result.getTimelineThreadsFromObjectRecord;

        if (!include_messages) {
          return timeline;
        }

        return {
          ...timeline,
          timelineThreads: await hydrateTimelineThreads(
            records,
            timeline.timelineThreads,
          ),
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_get_record_calendar_timeline',
    {
      title: 'Get a record calendar timeline',
      description:
        'Gets user-visible calendar events associated with any record, including event details, visibility, timing, location, and participants.',
      inputSchema: timelineInputSchema,
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      object_name_singular,
      record_id,
      page,
      page_size,
      response_format,
    }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          getTimelineCalendarEventsFromObjectRecord: unknown;
        }>(
          CALENDAR_TIMELINE_QUERY,
          {
            objectNameSingular: object_name_singular,
            recordId: record_id,
            page,
            pageSize: page_size,
          },
          { token: requireUserToken(dependencies.client) },
        );

        return result.getTimelineCalendarEventsFromObjectRecord;
      }, response_format),
  );
};

export const activityTimelineToolsTesting = {
  hydrateTimelineThreads,
};
