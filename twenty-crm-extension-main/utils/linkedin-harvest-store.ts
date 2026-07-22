import type {
  ExtensionResponse,
  GraphQLResponse,
  LinkedInHarvestConnection,
  LinkedInHarvestInvitation,
  LinkedInHarvestMessage,
  LinkedInHarvestThread,
  LinkedInSyncTotals,
} from '../types';
import type { TwentyApiClient } from './twenty-api';
import { ensureLinkedinSchema } from './twenty-linkedin-schema';

const TWENTY_BATCH_SIZE = 200;

type WriteResult = { received: number; alreadyKnown: number };

export type LinkedInMessageSyncCandidate = {
  threadId: string;
  threadExternalId: string;
  lastMessageTime: string;
  maxMessageTime: string | null;
};

export type LinkedInHarvestStoreRequest =
  | { action: 'ENSURE_SCHEMA' }
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
      action: 'WRITE_MESSAGES';
      ownerLinkedinId: string;
      records: LinkedInHarvestMessage[];
    }
  | { action: 'GET_OLDEST_THREAD'; ownerLinkedinId: string }
  | { action: 'GET_MESSAGE_SYNC_CANDIDATES'; ownerLinkedinId: string }
  | { action: 'GET_TOTALS' };

type CreatedRecord = { externalId: string; createdAt: string };

type MessageThreadsResult = {
  linkedinMessageThreads: {
    edges: Array<{
      node: {
        externalId: string;
        threadId: string;
        lastMessageTime: string;
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
): Promise<WriteResult> => {
  if (data.length === 0) {
    return { received: 0, alreadyKnown: 0 };
  }

  const mutation = `
    mutation Upsert${capitalize(objectNamePlural)}(
      $data: [${capitalize(objectNameSingular)}CreateInput!]!
      $upsert: Boolean
    ) {
      create${capitalize(objectNamePlural)}(data: $data, upsert: $upsert) {
        externalId
        createdAt
      }
    }
  `;
  let alreadyKnown = 0;

  for (const records of chunk(data, TWENTY_BATCH_SIZE)) {
    const result = await client.graphqlRequest<Record<string, CreatedRecord[]>>(
      mutation,
      { data: records, upsert: true },
    );
    const writtenRecords =
      result.data?.[`create${capitalize(objectNamePlural)}`] ?? [];

    if (runStartedAt) {
      alreadyKnown += writtenRecords.filter(
        (record) => new Date(record.createdAt).getTime() < runStartedAt,
      ).length;
    }
  }

  return { received: data.length, alreadyKnown };
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

const writeThreadsWithClient = (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  records: LinkedInHarvestThread[],
): Promise<WriteResult> =>
  upsertRecords(
    client,
    'linkedinMessageThread',
    'linkedinMessageThreads',
    records.map((record) => ({
      externalId: `${ownerLinkedinId}:${record.threadId}`,
      name: record.name,
      threadId: record.threadId,
      firstMessageTime: record.firstMessageTime,
      lastMessageTime: record.lastMessageTime,
      participants: record.participants,
      labels: record.labels,
      ownerLinkedinId,
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
      name: record.senderName || 'LinkedIn message',
      messageId: record.messageId,
      threadExternalId: record.threadExternalId,
      body: record.body,
      deliveredAt: record.deliveredAt,
      direction: record.direction,
      senderName: record.senderName,
      senderHandle: record.senderHandle,
      ownerLinkedinId,
    })),
  );

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

const getNewestMessageTime = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
  threadExternalId: string,
): Promise<string | null> => {
  const result = await client.graphqlRequest<{
    linkedinMessages: {
      edges: Array<{ node: { deliveredAt: string } }>;
    };
  }>(
    `
      query NewestLinkedinMessage(
        $ownerLinkedinId: String!
        $threadExternalId: String!
      ) {
        linkedinMessages(
          filter: {
            ownerLinkedinId: { eq: $ownerLinkedinId }
            threadExternalId: { eq: $threadExternalId }
          }
          orderBy: [{ deliveredAt: DescNullsLast }]
          first: 1
        ) {
          edges {
            node {
              deliveredAt
            }
          }
        }
      }
    `,
    { ownerLinkedinId, threadExternalId },
  );

  return result.data?.linkedinMessages.edges[0]?.node.deliveredAt ?? null;
};

const getMessageSyncCandidatesWithClient = async (
  client: TwentyApiClient,
  ownerLinkedinId: string,
): Promise<LinkedInMessageSyncCandidate[]> => {
  const threads: Array<{
    externalId: string;
    threadId: string;
    lastMessageTime: string;
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
                externalId
                threadId
                lastMessageTime
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
        const maxMessageTime = await getNewestMessageTime(
          client,
          ownerLinkedinId,
          thread.externalId,
        );

        return {
          threadId: thread.threadId,
          threadExternalId: thread.externalId,
          lastMessageTime: thread.lastMessageTime,
          maxMessageTime,
        };
      }),
    );

    candidates.push(
      ...batchCandidates.filter(
        (candidate) =>
          !candidate.maxMessageTime ||
          new Date(candidate.lastMessageTime).getTime() >
            new Date(candidate.maxMessageTime).getTime(),
      ),
    );
  }

  return candidates;
};

export const getLinkedInSyncTotalsWithClient = async (
  client: TwentyApiClient,
): Promise<LinkedInSyncTotals> => {
  try {
    const result = await client.metadataRequest<{
      objectRecordCounts: Array<{
        objectNamePlural: string;
        totalCount: number;
      }>;
    }>(`
      query LinkedinHarvestRecordCounts {
        objectRecordCounts {
          objectNamePlural
          totalCount
        }
      }
    `);
    const counts = new Map(
      (result.data?.objectRecordCounts ?? []).map((count) => [
        count.objectNamePlural,
        count.totalCount,
      ]),
    );
    const sentInvitationResult = await client.graphqlRequest<{
      linkedinInvitations: { totalCount: number };
    }>(`
      query SentLinkedinInvitationCount {
        linkedinInvitations(
          filter: { direction: { in: ["SENT"] } }
          first: 1
        ) {
          totalCount
        }
      }
    `);

    return {
      connections: counts.get('linkedinConnections') ?? 0,
      invitations:
        sentInvitationResult.data?.linkedinInvitations.totalCount ?? 0,
      threads: counts.get('linkedinMessageThreads') ?? 0,
      messages: counts.get('linkedinMessages') ?? 0,
    };
  } catch (error) {
    console.warn(
      '[Twenty] Metadata record counts unavailable; using data API:',
      error,
    );
  }

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
        const argumentsSource =
          key === 'invitations'
            ? '(filter: { direction: { in: ["SENT"] } }, first: 1)'
            : '(first: 1)';
        const result = await client.graphqlRequest<
          Record<string, { totalCount: number }>
        >(
          `query LinkedinHarvest${capitalize(key)}Count { ${objectName}${argumentsSource} { totalCount } }`,
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
  if (request.action !== 'GET_TOTALS') {
    await ensureLinkedinSchema(client);
  }

  switch (request.action) {
    case 'ENSURE_SCHEMA':
      return { ready: true };
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
    case 'WRITE_MESSAGES':
      return writeMessagesWithClient(
        client,
        request.ownerLinkedinId,
        request.records,
      );
    case 'GET_OLDEST_THREAD':
      return getOldestThreadWithClient(client, request.ownerLinkedinId);
    case 'GET_MESSAGE_SYNC_CANDIDATES':
      return getMessageSyncCandidatesWithClient(
        client,
        request.ownerLinkedinId,
      );
    case 'GET_TOTALS':
      return getLinkedInSyncTotalsWithClient(client);
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

export const ensureLinkedInHarvestSchema = (): Promise<{ ready: boolean }> =>
  sendStoreRequest({ action: 'ENSURE_SCHEMA' });

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
): Promise<WriteResult> =>
  sendStoreRequest({
    action: 'WRITE_THREADS',
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
