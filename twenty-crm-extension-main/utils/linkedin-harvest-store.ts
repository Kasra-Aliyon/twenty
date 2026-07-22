import type {
  ExtensionResponse,
  GraphQLResponse,
  LinkedInHarvestConnection,
  LinkedInHarvestInvitation,
  LinkedInHarvestMessage,
  LinkedInHarvestThread,
  LinkedInHarvestThreadParticipant,
  LinkedInSyncTotals,
} from '../types';
import type { TwentyApiClient } from './twenty-api';

const TWENTY_BATCH_SIZE = 200;
const LINKEDIN_MESSAGE_PREVIEW_MAX_LENGTH = 200;

type WriteResult = { received: number; alreadyKnown: number };

type WrittenRecord = {
  id: string;
  externalId: string;
  createdAt: string;
};

type UpsertResult = WriteResult & { writtenRecords: WrittenRecord[] };

export type LinkedInThreadWriteResult = WriteResult & {
  writtenThreads: Array<{ id: string; externalId: string }>;
};

export type LinkedInMessageSyncCandidate = {
  twentyThreadId: string;
  threadId: string;
  lastMessageTime: string;
  maxMessageTime: string | null;
};

export type LinkedInHarvestStoreRequest =
  | {
      action: 'WRITE_CONNECTIONS';
      ownerLinkedinId: string;
      records: LinkedInHarvestConnection[];
      runStartedAt: number;
    }
  | {
      action: 'WRITE_INVITATIONS';
      ownerLinkedinId: string;
      records: LinkedInHarvestInvitation[];
      runStartedAt: number;
    }
  | {
      action: 'WRITE_THREADS';
      ownerLinkedinId: string;
      records: LinkedInHarvestThread[];
    }
  | {
      action: 'WRITE_THREAD_PARTICIPANTS';
      ownerLinkedinId: string;
      records: LinkedInHarvestThreadParticipant[];
    }
  | {
      action: 'WRITE_MESSAGES';
      ownerLinkedinId: string;
      records: LinkedInHarvestMessage[];
    }
  | { action: 'UPDATE_THREAD_SUMMARY'; threadId: string }
  | { action: 'GET_OLDEST_THREAD'; ownerLinkedinId: string }
  | { action: 'GET_MESSAGE_SYNC_CANDIDATES'; ownerLinkedinId: string }
  | { action: 'GET_TOTALS'; ownerLinkedinId: string };

type MessageThreadsResult = {
  linkedinMessageThreads: {
    edges: Array<{
      node: {
        id: string;
        threadId: string;
        lastMessageTime: string;
        messageCount: number;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const chunk = <TValue>(values: TValue[], size: number): TValue[][] => {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);

const upsertRecords = async (
  client: TwentyApiClient,
  objectNameSingular: string,
  objectNamePlural: string,
  data: Array<Record<string, unknown>>,
  runStartedAt?: number,
): Promise<UpsertResult> => {
  if (data.length === 0) {
    return { received: 0, alreadyKnown: 0, writtenRecords: [] };
  }

  const mutation = `
    mutation Upsert${capitalize(objectNamePlural)}(
      $data: [${capitalize(objectNameSingular)}CreateInput!]!
      $upsert: Boolean
    ) {
      create${capitalize(objectNamePlural)}(data: $data, upsert: $upsert) {
        id
        externalId
        createdAt
      }
    }
  `;
  let alreadyKnown = 0;
  const allWrittenRecords: WrittenRecord[] = [];

  for (const records of chunk(data, TWENTY_BATCH_SIZE)) {
    const result = await client.graphqlRequest<Record<string, WrittenRecord[]>>(
      mutation,
      { data: records, upsert: true },
    );
    const writtenRecords =
      result.data?.[`create${capitalize(objectNamePlural)}`] ?? [];

    allWrittenRecords.push(...writtenRecords);

    if (runStartedAt) {
      alreadyKnown += writtenRecords.filter(
        (record) => new Date(record.createdAt).getTime() < runStartedAt,
      ).length;
    }
  }

  return {
    received: data.length,
    alreadyKnown,
    writtenRecords: allWrittenRecords,
  };
};

const writeConnectionsWithClient = (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  records: LinkedInHarvestConnection[],
  runStartedAt: number,
): Promise<WriteResult> =>
  upsertRecords(
    client,
    'linkedinConnection',
    'linkedinConnections',
    records.map((record) => ({
      externalId: `${ownerLinkedinId}:${record.profileUrn}`,
      name: record.name,
      handle: record.handle,
      headline: record.headline,
      profileUrl: {
        primaryLinkUrl: record.profileUrl,
        primaryLinkLabel: record.name,
      },
      linkedinUrn: record.linkedinUrn,
      connectedAt: record.connectedAt,
      ownerLinkedinId,
    })),
    runStartedAt,
  );

const writeInvitationsWithClient = (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  records: LinkedInHarvestInvitation[],
  runStartedAt: number,
): Promise<WriteResult> =>
  upsertRecords(
    client,
    'linkedinInvitation',
    'linkedinInvitations',
    records.map((record) => ({
      externalId: `${ownerLinkedinId}:${record.direction}:${record.profileUrn}`,
      name: record.name,
      direction: record.direction,
      handle: record.handle,
      headline: record.headline,
      message: record.message,
      sentAt: record.sentAt,
      ownerLinkedinId,
    })),
    runStartedAt,
  );

const writeThreadsWithClient = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  records: LinkedInHarvestThread[],
): Promise<LinkedInThreadWriteResult> => {
  const result = await upsertRecords(
    client,
    'linkedinMessageThread',
    'linkedinMessageThreads',
    records.map((record) => ({
      externalId: `${ownerLinkedinId}:${record.threadId}`,
      name: record.name,
      threadId: record.threadId,
      firstMessageTime: record.firstMessageTime,
      lastMessageTime: record.lastMessageTime,
      labels: record.labels,
      ownerLinkedinId,
    })),
  );

  return {
    received: result.received,
    alreadyKnown: result.alreadyKnown,
    writtenThreads: result.writtenRecords.map(({ id, externalId }) => ({
      id,
      externalId,
    })),
  };
};

const getParticipantExternalId = (
  ownerLinkedinId: string,
  record: LinkedInHarvestThreadParticipant,
): string => {
  const participantIdentifier =
    record.linkedinUrn ??
    record.linkedinId ??
    record.handle ??
    record.name.toLowerCase();

  return `${ownerLinkedinId}:${record.sourceThreadId}:${participantIdentifier}`;
};

const writeThreadParticipantsWithClient = (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  records: LinkedInHarvestThreadParticipant[],
): Promise<WriteResult> =>
  upsertRecords(
    client,
    'linkedinThreadParticipant',
    'linkedinThreadParticipants',
    records.map((record) => ({
      externalId: getParticipantExternalId(ownerLinkedinId, record),
      linkedinUrn: record.linkedinUrn,
      linkedinMemberId: record.linkedinId,
      name: record.name,
      headline: record.headline,
      handle: record.handle,
      profileUrl: record.profileUrl
        ? {
            primaryLinkUrl: record.profileUrl,
            primaryLinkLabel: record.name,
          }
        : null,
      isSelf: record.isSelf,
      threadId: record.threadId,
    })),
  );

const writeMessagesWithClient = (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  records: LinkedInHarvestMessage[],
): Promise<WriteResult> =>
  upsertRecords(
    client,
    'linkedinMessage',
    'linkedinMessages',
    records.map((record) => ({
      externalId: `${ownerLinkedinId}:${record.messageId}`,
      messageId: record.messageId,
      body: record.body,
      deliveredAt: record.deliveredAt,
      direction: record.direction,
      senderName: record.senderName,
      senderLinkedinUrn: record.senderLinkedinUrn,
      ownerLinkedinId,
      threadId: record.threadId,
    })),
  );

const updateThreadSummaryWithClient = async (
  client: TwentyApiClient,
  threadId: string,
): Promise<{ messageCount: number; lastMessagePreview: string }> => {
  const result = await client.graphqlRequest<{
    linkedinMessages: {
      edges: Array<{ node: { body: string } }>;
      totalCount: number;
    };
  }>(
    `
      query LinkedinMessageThreadSummary($threadId: UUID!) {
        linkedinMessages(
          filter: { threadId: { eq: $threadId } }
          orderBy: [{ deliveredAt: DescNullsLast }]
          first: 1
        ) {
          edges {
            node {
              body
            }
          }
          totalCount
        }
      }
    `,
    { threadId },
  );
  const messages = result.data?.linkedinMessages;
  const lastMessagePreview =
    messages?.edges[0]?.node.body
      .trim()
      .slice(0, LINKEDIN_MESSAGE_PREVIEW_MAX_LENGTH) ?? '';
  const messageCount = messages?.totalCount ?? 0;

  await client.graphqlRequest<{
    updateLinkedinMessageThread: { id: string };
  }>(
    `
      mutation UpdateLinkedinMessageThreadSummary(
        $id: UUID!
        $data: LinkedinMessageThreadUpdateInput!
      ) {
        updateLinkedinMessageThread(id: $id, data: $data) {
          id
        }
      }
    `,
    {
      id: threadId,
      data: { lastMessagePreview, messageCount },
    },
  );

  return { messageCount, lastMessagePreview };
};

const getOldestThreadWithClient = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
): Promise<{ threadId: string; lastMessageTime: string } | null> => {
  const result = await client.graphqlRequest<{
    linkedinMessageThreads: {
      edges: Array<{
        node: { threadId: string; lastMessageTime: string };
      }>;
    };
  }>(
    `
      query OldestLinkedinMessageThread($ownerLinkedinId: String!) {
        linkedinMessageThreads(
          filter: { ownerLinkedinId: { eq: $ownerLinkedinId } }
          orderBy: [{ lastMessageTime: AscNullsLast }]
          first: 1
        ) {
          edges {
            node {
              threadId
              lastMessageTime
            }
          }
        }
      }
    `,
    { ownerLinkedinId },
  );

  return result.data?.linkedinMessageThreads.edges[0]?.node ?? null;
};

const getMessageCheckpoint = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  threadId: string,
): Promise<{ maxMessageTime: string | null; messageCount: number }> => {
  const result = await client.graphqlRequest<{
    linkedinMessages: {
      edges: Array<{ node: { deliveredAt: string } }>;
      totalCount: number;
    };
  }>(
    `
      query NewestLinkedinMessage(
        $ownerLinkedinId: String!
        $threadId: UUID!
      ) {
        linkedinMessages(
          filter: {
            ownerLinkedinId: { eq: $ownerLinkedinId }
            threadId: { eq: $threadId }
          }
          orderBy: [{ deliveredAt: DescNullsLast }]
          first: 1
        ) {
          edges {
            node {
              deliveredAt
            }
          }
          totalCount
        }
      }
    `,
    { ownerLinkedinId, threadId },
  );

  return {
    maxMessageTime:
      result.data?.linkedinMessages.edges[0]?.node.deliveredAt ?? null,
    messageCount: result.data?.linkedinMessages.totalCount ?? 0,
  };
};

const getMessageSyncCandidatesWithClient = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
): Promise<LinkedInMessageSyncCandidate[]> => {
  const threads: Array<{
    id: string;
    threadId: string;
    lastMessageTime: string;
    messageCount: number;
  }> = [];
  let after: string | null = null;

  do {
    const result: GraphQLResponse<MessageThreadsResult> =
      await client.graphqlRequest<MessageThreadsResult>(
        `
        query LinkedinMessageSyncCandidates(
          $ownerLinkedinId: String!
          $after: String
        ) {
          linkedinMessageThreads(
            filter: { ownerLinkedinId: { eq: $ownerLinkedinId } }
            first: 200
            after: $after
          ) {
            edges {
              node {
                id
                threadId
                lastMessageTime
                messageCount
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
        { ownerLinkedinId, after },
      );
    const connection:
      | MessageThreadsResult['linkedinMessageThreads']
      | undefined = result.data?.linkedinMessageThreads;

    if (!connection) {
      break;
    }

    threads.push(...connection.edges.map(({ node }) => node));
    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  const candidates: LinkedInMessageSyncCandidate[] = [];

  for (const threadBatch of chunk(threads, 20)) {
    const batchCandidates = await Promise.all(
      threadBatch.map(async (thread) => {
        const checkpoint = await getMessageCheckpoint(
          client,
          ownerLinkedinId,
          thread.id,
        );

        return {
          syncCandidate: {
            twentyThreadId: thread.id,
            threadId: thread.threadId,
            lastMessageTime: thread.lastMessageTime,
            maxMessageTime: checkpoint.maxMessageTime,
          },
          summaryIsStale: thread.messageCount !== checkpoint.messageCount,
        };
      }),
    );

    candidates.push(
      ...batchCandidates
        .filter(
          ({ summaryIsStale, syncCandidate }) =>
            !syncCandidate.maxMessageTime ||
            summaryIsStale ||
            new Date(syncCandidate.lastMessageTime).getTime() >
              new Date(syncCandidate.maxMessageTime).getTime(),
        )
        .map(({ syncCandidate }) => syncCandidate),
    );
  }

  return candidates;
};

export const getLinkedInSyncTotalsWithClient = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
): Promise<LinkedInSyncTotals> => {
  const objectNames = [
    ['connections', 'linkedinConnections'],
    ['invitations', 'linkedinInvitations'],
    ['threads', 'linkedinMessageThreads'],
    ['messages', 'linkedinMessages'],
  ] as const;
  const totals: LinkedInSyncTotals = {
    connections: 0,
    invitations: 0,
    threads: 0,
    messages: 0,
  };

  await Promise.all(
    objectNames.map(async ([key, objectName]) => {
      try {
        const result = await client.graphqlRequest<
          Record<string, { totalCount: number }>
        >(
          `
            query LinkedinSync${capitalize(key)}Count($ownerLinkedinId: String!) {
              ${objectName}(
                filter: { ownerLinkedinId: { eq: $ownerLinkedinId } }
                first: 1
              ) {
                totalCount
              }
            }
          `,
          { ownerLinkedinId },
        );

        totals[key] = result.data?.[objectName]?.totalCount ?? 0;
      } catch {
        totals[key] = 0;
      }
    }),
  );

  return totals;
};

export const handleLinkedInHarvestStoreRequest = async (
  client: TwentyApiClient,
  request: LinkedInHarvestStoreRequest,
): Promise<unknown> => {
  switch (request.action) {
    case 'WRITE_CONNECTIONS':
      return writeConnectionsWithClient(
        client,
        request.ownerLinkedinId,
        request.records,
        request.runStartedAt,
      );
    case 'WRITE_INVITATIONS':
      return writeInvitationsWithClient(
        client,
        request.ownerLinkedinId,
        request.records,
        request.runStartedAt,
      );
    case 'WRITE_THREADS':
      return writeThreadsWithClient(
        client,
        request.ownerLinkedinId,
        request.records,
      );
    case 'WRITE_THREAD_PARTICIPANTS':
      return writeThreadParticipantsWithClient(
        client,
        request.ownerLinkedinId,
        request.records,
      );
    case 'WRITE_MESSAGES':
      return writeMessagesWithClient(
        client,
        request.ownerLinkedinId,
        request.records,
      );
    case 'UPDATE_THREAD_SUMMARY':
      return updateThreadSummaryWithClient(client, request.threadId);
    case 'GET_OLDEST_THREAD':
      return getOldestThreadWithClient(client, request.ownerLinkedinId);
    case 'GET_MESSAGE_SYNC_CANDIDATES':
      return getMessageSyncCandidatesWithClient(
        client,
        request.ownerLinkedinId,
      );
    case 'GET_TOTALS':
      return getLinkedInSyncTotalsWithClient(client, request.ownerLinkedinId);
  }
};

const sendStoreRequest = async <TData>(
  request: LinkedInHarvestStoreRequest,
): Promise<TData> => {
  const response = (await browser.runtime.sendMessage({
    type: 'LINKEDIN_HARVEST_STORE',
    payload: request,
  })) as ExtensionResponse<TData>;

  if (!response.success || response.data === undefined) {
    throw new Error(
      response.error || 'Twenty rejected the LinkedIn sync write',
    );
  }

  return response.data;
};

export const writeLinkedInConnections = (
  ownerLinkedinId: string,
  records: LinkedInHarvestConnection[],
  runStartedAt: number,
): Promise<WriteResult> =>
  sendStoreRequest({
    action: 'WRITE_CONNECTIONS',
    ownerLinkedinId,
    records,
    runStartedAt,
  });

export const writeLinkedInInvitations = (
  ownerLinkedinId: string,
  records: LinkedInHarvestInvitation[],
  runStartedAt: number,
): Promise<WriteResult> =>
  sendStoreRequest({
    action: 'WRITE_INVITATIONS',
    ownerLinkedinId,
    records,
    runStartedAt,
  });

export const writeLinkedInThreads = (
  ownerLinkedinId: string,
  records: LinkedInHarvestThread[],
): Promise<LinkedInThreadWriteResult> =>
  sendStoreRequest({
    action: 'WRITE_THREADS',
    ownerLinkedinId,
    records,
  });

export const writeLinkedInThreadParticipants = (
  ownerLinkedinId: string,
  records: LinkedInHarvestThreadParticipant[],
): Promise<WriteResult> =>
  sendStoreRequest({
    action: 'WRITE_THREAD_PARTICIPANTS',
    ownerLinkedinId,
    records,
  });

export const writeLinkedInMessages = (
  ownerLinkedinId: string,
  records: LinkedInHarvestMessage[],
): Promise<WriteResult> =>
  sendStoreRequest({
    action: 'WRITE_MESSAGES',
    ownerLinkedinId,
    records,
  });

export const updateLinkedInThreadSummary = (
  threadId: string,
): Promise<{ messageCount: number; lastMessagePreview: string }> =>
  sendStoreRequest({ action: 'UPDATE_THREAD_SUMMARY', threadId });

export const getOldestLinkedInThread = (
  ownerLinkedinId: string,
): Promise<{ threadId: string; lastMessageTime: string } | null> =>
  sendStoreRequest({ action: 'GET_OLDEST_THREAD', ownerLinkedinId });

export const getLinkedInMessageSyncCandidates = (
  ownerLinkedinId: string,
): Promise<LinkedInMessageSyncCandidate[]> =>
  sendStoreRequest({
    action: 'GET_MESSAGE_SYNC_CANDIDATES',
    ownerLinkedinId,
  });
