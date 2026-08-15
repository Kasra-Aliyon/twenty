import type {
  LinkedInHarvestMessage,
  LinkedInHarvestParticipant,
  LinkedInHarvestReadReceipt,
  LinkedInHarvestThread,
  LinkedInHarvestThreadParticipant,
  LinkedInIdentity,
  LinkedInMessageReadConfirmation,
  LinkedInSyncProgress,
} from '../types';
import {
  confirmLinkedInMessageReads,
  getLinkedInMessageSyncCandidates,
  getOldestLinkedInThread,
  updateLinkedInThreadSummary,
  writeLinkedInMessages,
  writeLinkedInThreadParticipants,
  writeLinkedInThreads,
} from './linkedin-harvest-store';
import {
  getLinkedInSyncState,
  LINKEDIN_MESSAGE_SYNC_REVISION,
  updateLinkedInSyncState,
} from './linkedin-sync-state';
import { linkedInVoyagerClient, randomDelay } from './linkedin-voyager-client';

const THREAD_PAGE_SIZE = 25;
const MESSAGE_PAGE_SIZE = 100;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

const getValue = (value: unknown, path: string[]): unknown => {
  let current: unknown = value;

  for (const key of path) {
    current = asRecord(current)?.[key];
  }

  return current;
};

const getString = (value: unknown, path: string[]): string | null => {
  const candidate = getValue(value, path);

  return typeof candidate === 'string' ? candidate : null;
};

const getNumber = (value: unknown, path: string[]): number | null => {
  const candidate = getValue(value, path);

  return typeof candidate === 'number' ? candidate : null;
};

const getTimestamp = (value: unknown, path: string[]): number | null => {
  const candidate = getValue(value, path);

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === 'string' && candidate.trim() !== '') {
    const timestamp = Number(candidate);

    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
};

const getArray = (value: unknown, path: string[]): unknown[] => {
  const candidate = getValue(value, path);

  return Array.isArray(candidate) ? candidate : [];
};

const getFirstString = (value: unknown, paths: string[][]): string | null => {
  for (const path of paths) {
    const candidate = getString(value, path);

    if (candidate) {
      return candidate;
    }
  }

  return null;
};

const getUrnId = (urn: string): string => {
  const separatorIndex = urn.lastIndexOf(':');

  return separatorIndex === -1 ? urn : urn.slice(separatorIndex + 1);
};

const getCompositeUrnId = (value: string): string => {
  if (!value.startsWith('(') || !value.endsWith(')')) {
    return value;
  }

  const separatorIndex = value.lastIndexOf(',');

  return separatorIndex === -1 ? value : value.slice(separatorIndex + 1, -1);
};

const getMessageIdFromEventUrn = (value: string): string | null => {
  const match = value.match(/\((?:[^,]+),([^)]+)\)$/);

  return match?.[1] ?? null;
};

const normalizeHandle = (value: string): string => {
  try {
    const url = new URL(
      value.startsWith('http') ? value : `https://www.linkedin.com/in/${value}`,
    );

    return decodeURIComponent(
      url.pathname.match(/^\/in\/([^/]+)/)?.[1] ?? value,
    );
  } catch {
    return decodeURIComponent(value);
  }
};

const toParticipant = (
  value: unknown,
  identity: LinkedInIdentity,
): LinkedInHarvestParticipant => {
  const member =
    getValue(value, ['participantType', 'member']) ??
    getValue(value, ['miniProfile']) ??
    value;
  const firstName =
    getFirstString(member, [['firstName', 'text'], ['firstName']]) ?? '';
  const lastName =
    getFirstString(member, [['lastName', 'text'], ['lastName']]) ?? '';
  const entityUrn = getString(value, ['entityUrn']);
  const currentLinkedinId = entityUrn ? getUrnId(entityUrn) : null;
  const linkedinId =
    getString(value, ['backendUrn'])?.replace('urn:li:member:', '') ??
    currentLinkedinId;
  const linkedinUrn =
    getString(value, ['hostIdentityUrn'])?.replace('urn:li:fsd_profile:', '') ??
    currentLinkedinId;
  const rawHandle = getFirstString(member, [
    ['publicIdentifier'],
    ['publicIdentifier', 'text'],
  ]);
  const handle = rawHandle ? normalizeHandle(rawHandle) : null;

  return {
    linkedinId,
    linkedinUrn,
    name: `${firstName} ${lastName}`.trim() || 'LinkedIn member',
    headline: getFirstString(member, [['headline', 'text'], ['headline']]),
    handle,
    profileUrl: handle
      ? `https://www.linkedin.com/in/${encodeURIComponent(handle)}/`
      : null,
    isSelf:
      linkedinId === identity.linkedinId ||
      linkedinUrn === identity.linkedinUrn,
  };
};

const getThreadId = (value: unknown): string | null => {
  const backendUrn = getString(value, ['backendUrn']);

  if (backendUrn) {
    return backendUrn.replace('urn:li:messagingThread:', '');
  }

  const entityId = getString(value, ['entityUrn'])?.replace(
    'urn:li:msg_conversation:',
    '',
  );

  return entityId ? getCompositeUrnId(entityId) : null;
};

const isSyncableThread = (value: unknown): boolean =>
  Boolean(
    getThreadId(value) &&
    getArray(value, ['conversationParticipants']).length > 0,
  );

const toThread = (
  value: unknown,
  identity: LinkedInIdentity,
): LinkedInHarvestThread | null => {
  const threadId = getThreadId(value);
  const lastActivityAt = getNumber(value, ['lastActivityAt']);
  const createdAt = getNumber(value, ['createdAt']) ?? lastActivityAt;

  if (!threadId || createdAt === null || lastActivityAt === null) {
    return null;
  }

  const participants = getArray(value, ['conversationParticipants']).map(
    (participant) => toParticipant(participant, identity),
  );
  const otherParticipantNames = participants
    .filter((participant) => !participant.isSelf)
    .map((participant) => participant.name);

  return {
    threadId,
    name:
      otherParticipantNames.join(', ') ||
      participants.map((participant) => participant.name).join(', ') ||
      `LinkedIn thread ${threadId}`,
    firstMessageTime: new Date(createdAt).toISOString(),
    lastMessageTime: new Date(lastActivityAt).toISOString(),
    participants,
    labels: getArray(value, ['categories'])
      .filter((category): category is string => typeof category === 'string')
      .map((category) => category.toLowerCase()),
  };
};

const getReadReceiptValues = (value: unknown): unknown[] => [
  ...getArray(value, ['receipts']),
  ...getArray(value, ['readReceipts']),
  ...getArray(value, ['seenReceipts']),
];

const toReadReceipts = (
  value: unknown,
  identity: LinkedInIdentity,
): LinkedInHarvestReadReceipt[] => {
  const thread = toThread(value, identity);

  if (!thread) {
    return [];
  }

  const otherParticipants = thread.participants.filter(
    (participant) => !participant.isSelf,
  );

  // A single timestamp cannot represent which members read a group thread.
  if (otherParticipants.length !== 1) {
    return [];
  }

  const recipient = otherParticipants[0];
  const recipientIdentifiers = new Set(
    [recipient.linkedinId, recipient.linkedinUrn].filter(
      (identifier): identifier is string => identifier !== null,
    ),
  );
  const selfIdentifiers = new Set([identity.linkedinId, identity.linkedinUrn]);

  return getReadReceiptValues(value).flatMap((receipt) => {
    const eventUrn = getString(receipt, ['seenReceipt', 'eventUrn']);
    const seenAt = getTimestamp(receipt, ['seenReceipt', 'seenAt']);
    const fromEntity = getString(receipt, ['fromEntity']);
    const fromParticipant = getString(receipt, ['fromParticipant', 'string']);
    const readerIdentifiers = [fromEntity, fromParticipant]
      .filter((identifier): identifier is string => identifier !== null)
      .map(getUrnId);

    if (
      !eventUrn ||
      seenAt === null ||
      readerIdentifiers.length === 0 ||
      readerIdentifiers.some((identifier) => selfIdentifiers.has(identifier)) ||
      (recipientIdentifiers.size > 0 &&
        !readerIdentifiers.some((identifier) =>
          recipientIdentifiers.has(identifier),
        ))
    ) {
      return [];
    }

    const readThroughMessageId = getMessageIdFromEventUrn(eventUrn);

    if (!readThroughMessageId) {
      return [];
    }

    return [
      {
        sourceThreadId: thread.threadId,
        readThroughMessageId,
        recipientReadAt: new Date(seenAt).toISOString(),
      },
    ];
  });
};

type ReadConfirmationMap = Map<string, LinkedInMessageReadConfirmation>;

const mergeReadConfirmation = (
  confirmations: ReadConfirmationMap,
  confirmation: LinkedInMessageReadConfirmation,
): void => {
  const key = `${confirmation.threadId}:${confirmation.readThroughMessageId}`;
  const existing = confirmations.get(key);

  if (
    !existing ||
    Date.parse(confirmation.recipientReadAt) <
      Date.parse(existing.recipientReadAt)
  ) {
    confirmations.set(key, confirmation);
  }
};

const writeThreadPage = async (
  values: unknown[],
  identity: LinkedInIdentity,
  progress: LinkedInSyncProgress,
  readConfirmations: ReadConfirmationMap,
): Promise<void> => {
  const byThreadId = new Map<string, LinkedInHarvestThread>();

  for (const value of values) {
    const thread = toThread(value, identity);

    if (thread) {
      byThreadId.set(thread.threadId, thread);
    }
  }

  const threads = [...byThreadId.values()];

  if (threads.length > 0) {
    progress.threads += threads.length;
    const result = await writeLinkedInThreads(identity.linkedinId, threads);
    const twentyThreadIdByExternalId = new Map(
      result.writtenThreads.map((thread) => [thread.externalId, thread.id]),
    );
    const participants: LinkedInHarvestThreadParticipant[] = threads.flatMap(
      (thread) => {
        const twentyThreadId = twentyThreadIdByExternalId.get(
          `${identity.linkedinId}:${thread.threadId}`,
        );

        if (!twentyThreadId) {
          throw new Error(
            `Twenty did not return the upserted LinkedIn thread ${thread.threadId}`,
          );
        }

        return thread.participants.map((participant) => ({
          ...participant,
          sourceThreadId: thread.threadId,
          threadId: twentyThreadId,
        }));
      },
    );

    await writeLinkedInThreadParticipants(identity.linkedinId, participants);

    for (const value of values) {
      for (const receipt of toReadReceipts(value, identity)) {
        const threadId = twentyThreadIdByExternalId.get(
          `${identity.linkedinId}:${receipt.sourceThreadId}`,
        );

        if (!threadId) {
          continue;
        }

        mergeReadConfirmation(readConfirmations, {
          threadId,
          readThroughMessageId: receipt.readThroughMessageId,
          recipientReadAt: receipt.recipientReadAt,
        });
      }
    }
  }
};

type IncrementalResult = {
  runHighWater: number | null;
  crossedBoundary: boolean;
  exhausted: boolean;
};

const syncIncrementalThreads = async (
  identity: LinkedInIdentity,
  since: number,
  progress: LinkedInSyncProgress,
  readConfirmations: ReadConfirmationMap,
): Promise<IncrementalResult> => {
  let pagination = {
    cursor: null as string | null,
    updatedBefore: Date.now() + 1,
  };
  let runHighWater: number | null = null;
  let crossedBoundary = since === 0;
  let exhausted = false;

  for (;;) {
    const page = await linkedInVoyagerClient.fetchMessageThreadsPage(
      identity.linkedinUrn,
      pagination,
      THREAD_PAGE_SIZE,
    );
    const elements = [...page.elements].sort(
      (first, second) =>
        (getNumber(second, ['lastActivityAt']) ?? 0) -
        (getNumber(first, ['lastActivityAt']) ?? 0),
    );

    if (elements.length === 0) {
      exhausted = true;
      crossedBoundary = true;
      break;
    }

    const pageThreads: unknown[] = [];
    let shouldStop = false;

    for (const element of elements) {
      const lastActivityAt = getNumber(element, ['lastActivityAt']);

      runHighWater ??= lastActivityAt;

      if (isSyncableThread(element)) {
        pageThreads.push(element);
      }

      if (since > 0 && lastActivityAt !== null && lastActivityAt <= since) {
        crossedBoundary = true;
        shouldStop = true;
        break;
      }
    }

    await writeThreadPage(pageThreads, identity, progress, readConfirmations);

    if (since === 0) {
      shouldStop = true;
    }

    if (shouldStop) {
      break;
    }

    if (!page.hasMore) {
      exhausted = true;
      crossedBoundary = true;
      break;
    }

    if (page.threadPaginationMode === 'cursor') {
      const nextCursor = page.nextCursor ?? null;

      if (!nextCursor || nextCursor === pagination.cursor) {
        exhausted = true;
        crossedBoundary = true;
        break;
      }

      pagination = { ...pagination, cursor: nextCursor };
    } else {
      const nextUpdatedBefore = page.nextUpdatedBefore ?? null;

      if (
        nextUpdatedBefore === null ||
        nextUpdatedBefore >= pagination.updatedBefore
      ) {
        exhausted = true;
        crossedBoundary = true;
        break;
      }

      pagination = { ...pagination, updatedBefore: nextUpdatedBefore };
    }

    await randomDelay(500, 5_000);
  }

  return { runHighWater, crossedBoundary, exhausted };
};

const syncHistoricalThreads = async (
  identity: LinkedInIdentity,
  progress: LinkedInSyncProgress,
  readConfirmations: ReadConfirmationMap,
): Promise<boolean> => {
  const oldestThread = await getOldestLinkedInThread(identity.linkedinId);

  if (!oldestThread) {
    return false;
  }

  const oldestThreadTime = new Date(oldestThread.lastMessageTime).getTime() + 1;
  let pagination = {
    cursor: btoa(`DESCENDING&${oldestThreadTime}&${oldestThread.threadId}`),
    updatedBefore: oldestThreadTime,
  };

  for (;;) {
    const page = await linkedInVoyagerClient.fetchMessageThreadsPage(
      identity.linkedinUrn,
      pagination,
      THREAD_PAGE_SIZE,
    );
    const elements = [...page.elements].sort(
      (first, second) =>
        (getNumber(second, ['lastActivityAt']) ?? 0) -
        (getNumber(first, ['lastActivityAt']) ?? 0),
    );

    if (elements.length === 0) {
      return true;
    }

    await writeThreadPage(
      elements.filter(isSyncableThread),
      identity,
      progress,
      readConfirmations,
    );

    if (!page.hasMore) {
      return true;
    }

    if (page.threadPaginationMode === 'cursor') {
      const nextCursor = page.nextCursor ?? null;

      if (!nextCursor || nextCursor === pagination.cursor) {
        return true;
      }

      pagination = { ...pagination, cursor: nextCursor };
    } else {
      const nextUpdatedBefore = page.nextUpdatedBefore ?? null;

      if (
        nextUpdatedBefore === null ||
        nextUpdatedBefore >= pagination.updatedBefore
      ) {
        return true;
      }

      pagination = { ...pagination, updatedBefore: nextUpdatedBefore };
    }

    await randomDelay(500, 5_000);
  }
};

const toMessage = (
  value: unknown,
  identity: LinkedInIdentity,
  threadId: string,
): LinkedInHarvestMessage | null => {
  const messageId = getFirstString(value, [['backendUrn'], ['entityUrn']])
    ?.replace('urn:li:messagingMessage:', '')
    .replace('urn:li:msg_message:', '');
  const deliveredAt = getNumber(value, ['deliveredAt']);

  if (!messageId || deliveredAt === null) {
    return null;
  }

  const actor = getValue(value, ['actor']) ?? getValue(value, ['sender']);
  const sender = actor ? toParticipant(actor, identity) : null;

  return {
    messageId: getCompositeUrnId(messageId),
    threadId,
    body: getString(value, ['body', 'text']) ?? '',
    deliveredAt: new Date(deliveredAt).toISOString(),
    direction: sender?.isSelf === true ? 'OUTBOUND' : 'INBOUND',
    senderName: sender?.name ?? 'LinkedIn member',
    senderLinkedinUrn: sender?.linkedinUrn ?? null,
  };
};

const syncMessagesForCandidate = async (
  identity: LinkedInIdentity,
  candidate: Awaited<
    ReturnType<typeof getLinkedInMessageSyncCandidates>
  >[number],
  progress: LinkedInSyncProgress,
): Promise<void> => {
  const conversationUrn =
    `urn:li:msg_conversation:` +
    `(urn:li:fsd_profile:${identity.linkedinUrn},${candidate.threadId})`;
  const syncingAfter = candidate.maxMessageTime !== null;
  const boundary = candidate.maxMessageTime
    ? new Date(candidate.maxMessageTime).getTime()
    : null;
  let anchor = boundary ?? Date.now();

  for (;;) {
    const page = await linkedInVoyagerClient.getThreadMessagesPagination(
      conversationUrn,
      anchor,
      syncingAfter ? 0 : MESSAGE_PAGE_SIZE,
      syncingAfter ? MESSAGE_PAGE_SIZE : 0,
    );

    if (page.elements.length === 0) {
      break;
    }

    const messages = page.elements
      .map((element) => toMessage(element, identity, candidate.twentyThreadId))
      .filter((message): message is LinkedInHarvestMessage => message !== null)
      .filter(
        (message) =>
          boundary === null ||
          new Date(message.deliveredAt).getTime() > boundary,
      );

    if (messages.length > 0) {
      progress.messages += messages.length;
      await writeLinkedInMessages(identity.linkedinId, messages);
    }

    const nextAnchor = syncingAfter
      ? getNumber(page.elements.at(-1), ['deliveredAt'])
      : getNumber(page.elements[0], ['deliveredAt']);

    if (
      nextAnchor === null ||
      nextAnchor === anchor ||
      page.elements.length < MESSAGE_PAGE_SIZE
    ) {
      break;
    }

    anchor = nextAnchor;
    await randomDelay(500, 5_000);
  }

  await updateLinkedInThreadSummary(candidate.twentyThreadId);
};

const syncMissingMessages = async (
  identity: LinkedInIdentity,
  progress: LinkedInSyncProgress,
): Promise<void> => {
  const candidates = await getLinkedInMessageSyncCandidates(
    identity.linkedinId,
  );

  for (const candidate of candidates) {
    await syncMessagesForCandidate(identity, candidate, progress);
  }
};

export const syncLinkedInMessages = async (
  identity: LinkedInIdentity,
  progress: LinkedInSyncProgress,
): Promise<void> => {
  let state = await getLinkedInSyncState(identity.linkedinId);

  if (state.messageSyncRevision !== LINKEDIN_MESSAGE_SYNC_REVISION) {
    state = await updateLinkedInSyncState(identity.linkedinId, {
      historicalBackfillComplete: false,
      messageSyncRevision: LINKEDIN_MESSAGE_SYNC_REVISION,
    });
  }

  const since = state.safeSyncedThroughLastActivityAt ?? 0;
  const readConfirmations: ReadConfirmationMap = new Map();
  const incrementalResult = await syncIncrementalThreads(
    identity,
    since,
    progress,
    readConfirmations,
  );

  if (
    incrementalResult.runHighWater &&
    incrementalResult.crossedBoundary &&
    incrementalResult.runHighWater > since
  ) {
    await updateLinkedInSyncState(identity.linkedinId, {
      safeSyncedThroughLastActivityAt: incrementalResult.runHighWater,
    });
  }

  if (incrementalResult.exhausted) {
    await updateLinkedInSyncState(identity.linkedinId, {
      historicalBackfillComplete: true,
    });
  } else if (!state.historicalBackfillComplete) {
    const historicalBackfillComplete = await syncHistoricalThreads(
      identity,
      progress,
      readConfirmations,
    );

    if (historicalBackfillComplete) {
      await updateLinkedInSyncState(identity.linkedinId, {
        historicalBackfillComplete: true,
      });
    }
  }

  await syncMissingMessages(identity, progress);

  if (readConfirmations.size > 0) {
    try {
      await confirmLinkedInMessageReads(identity.linkedinId, [
        ...readConfirmations.values(),
      ]);
    } catch (error) {
      console.warn(
        '[Twenty] LinkedIn messages synced, but read receipts could not be stored:',
        error,
      );
    }
  }
};

export const linkedinSyncMessagesTesting = { toReadReceipts };
