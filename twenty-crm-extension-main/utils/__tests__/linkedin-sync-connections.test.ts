import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LinkedInHarvestConnection,
  LinkedInSyncProgress,
  LinkedInSyncState,
} from '../../types';

type TestVoyagerPage = {
  response: Record<string, unknown>;
  elements: unknown[];
  included: unknown[];
  hasMore: boolean;
  nextStart: number | null;
};

type FetchPage = (start?: number, count?: number) => Promise<TestVoyagerPage>;

type FetchReceivedInvitationsPage = (
  start?: number,
  count?: number,
) => Promise<TestVoyagerPage | null>;

type WriteConnections = (
  ownerLinkedinId: string,
  records: LinkedInHarvestConnection[],
  runStartedAt: number,
) => Promise<{ received: number; alreadyKnown: number }>;

const mocks = vi.hoisted(() => ({
  fetchConnectionsPage: vi.fn<FetchPage>(),
  fetchSentInvitationsPage: vi.fn<FetchPage>(),
  fetchReceivedInvitationsPage: vi.fn<FetchReceivedInvitationsPage>(),
  randomDelay: vi.fn<() => Promise<void>>(),
  writeLinkedInConnections: vi.fn<WriteConnections>(),
  writeLinkedInInvitations: vi.fn(),
}));

vi.mock('../linkedin-harvest-store', () => ({
  writeLinkedInConnections: mocks.writeLinkedInConnections,
  writeLinkedInInvitations: mocks.writeLinkedInInvitations,
}));

vi.mock('../linkedin-voyager-client', () => ({
  linkedInVoyagerClient: {
    fetchConnectionsPage: mocks.fetchConnectionsPage,
    fetchSentInvitationsPage: mocks.fetchSentInvitationsPage,
    fetchReceivedInvitationsPage: mocks.fetchReceivedInvitationsPage,
  },
  randomDelay: mocks.randomDelay,
}));

import { syncLinkedInConnectionsAndInvitations } from '../linkedin-sync-connections';
import {
  getLinkedInSyncState,
  LINKEDIN_CONNECTION_SYNC_REVISION,
} from '../linkedin-sync-state';

const OWNER_LINKEDIN_ID = 'owner-id';
const RUN_STARTED_AT = new Date('2026-07-22T12:00:00.000Z').getTime();
const SYNC_STATE_KEY = `twentyLinkedinSyncState:${OWNER_LINKEDIN_ID}`;

const storedValues = new Map<string, unknown>();
const storageLocalGet = vi.fn(async (key: string) => ({
  [key]: storedValues.get(key),
}));
const storageLocalSet = vi.fn(
  async (values: Record<string, unknown>): Promise<void> => {
    for (const [key, value] of Object.entries(values)) {
      storedValues.set(key, value);
    }
  },
);

const emptyPage = (): TestVoyagerPage => ({
  response: {},
  elements: [],
  included: [],
  hasMore: false,
  nextStart: null,
});

const connectionPage = (
  start: number,
  hasMore: boolean,
  nextStart: number | null,
): TestVoyagerPage => {
  const entityUrn = `urn:li:fsd_profile:ACoA${start.toString().padStart(7, '0')}`;

  return {
    response: {},
    elements: [entityUrn],
    included: [
      {
        $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
        entityUrn,
        publicIdentifier: `contact-${start}`,
        firstName: 'Contact',
        lastName: start.toString(),
      },
      {
        $type: 'com.linkedin.voyager.dash.relationships.Connection',
        connectedMember: entityUrn,
        createdAt: RUN_STARTED_AT - start,
      },
    ],
    hasMore,
    nextStart,
  };
};

const createProgress = (): LinkedInSyncProgress => ({
  connections: 0,
  invitations: 0,
  threads: 0,
  messages: 0,
});

const seedSyncState = (state: Partial<LinkedInSyncState>) => {
  storedValues.set(SYNC_STATE_KEY, state);
};

const getRequestedConnectionStarts = (fromCall = 0): number[] =>
  mocks.fetchConnectionsPage.mock.calls
    .slice(fromCall)
    .map(([start]) => start ?? 0);

describe('LinkedIn connection revision backfill', () => {
  beforeEach(() => {
    storedValues.clear();
    storageLocalGet.mockClear();
    storageLocalSet.mockClear();
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: storageLocalGet,
          set: storageLocalSet,
        },
      },
    });

    mocks.fetchConnectionsPage.mockReset();
    mocks.fetchSentInvitationsPage.mockReset();
    mocks.fetchReceivedInvitationsPage.mockReset();
    mocks.randomDelay.mockReset();
    mocks.writeLinkedInConnections.mockReset();
    mocks.writeLinkedInInvitations.mockReset();

    mocks.fetchSentInvitationsPage.mockResolvedValue(emptyPage());
    mocks.fetchReceivedInvitationsPage.mockResolvedValue(emptyPage());
    mocks.randomDelay.mockResolvedValue(undefined);
    mocks.writeLinkedInInvitations.mockResolvedValue({
      received: 0,
      alreadyKnown: 0,
    });
  });

  it('fully backfills an upgraded state even when the first page is already known', async () => {
    seedSyncState({
      connectionBackfillComplete: true,
      connectionBackfillStart: 0,
      connectionSyncRevision: 0,
      lastConnectionSyncAt: RUN_STARTED_AT - 1,
    });
    mocks.fetchConnectionsPage.mockImplementation(async (start = 0) => {
      if (start === 0) {
        return connectionPage(0, true, 100);
      }

      return connectionPage(100, false, null);
    });
    mocks.writeLinkedInConnections.mockResolvedValue({
      received: 1,
      alreadyKnown: 50,
    });

    await syncLinkedInConnectionsAndInvitations(
      OWNER_LINKEDIN_ID,
      RUN_STARTED_AT,
      createProgress(),
    );

    expect(getRequestedConnectionStarts()).toEqual([0, 100]);
    expect(mocks.writeLinkedInConnections).toHaveBeenCalledTimes(2);
    await expect(
      getLinkedInSyncState(OWNER_LINKEDIN_ID),
    ).resolves.toMatchObject({
      connectionBackfillComplete: true,
      connectionBackfillStart: 0,
      connectionSyncRevision: LINKEDIN_CONNECTION_SYNC_REVISION,
    });
  });

  it('keeps the last successful checkpoint and resumes with one page of overlap', async () => {
    seedSyncState({
      connectionBackfillComplete: true,
      connectionBackfillStart: 0,
      connectionSyncRevision: 0,
    });
    mocks.fetchConnectionsPage.mockImplementation(async (start = 0) =>
      start < 300
        ? connectionPage(start, true, start + 100)
        : connectionPage(start, false, null),
    );
    let shouldFailOldestPage = true;

    mocks.writeLinkedInConnections.mockImplementation(
      async (_ownerLinkedinId, records) => {
        if (records[0]?.handle === 'contact-300' && shouldFailOldestPage) {
          shouldFailOldestPage = false;
          throw new Error('CRM write failed');
        }

        return { received: records.length, alreadyKnown: records.length };
      },
    );

    await expect(
      syncLinkedInConnectionsAndInvitations(
        OWNER_LINKEDIN_ID,
        RUN_STARTED_AT,
        createProgress(),
      ),
    ).rejects.toThrow('CRM write failed');

    expect(getRequestedConnectionStarts()).toEqual([0, 100, 200, 300]);
    await expect(
      getLinkedInSyncState(OWNER_LINKEDIN_ID),
    ).resolves.toMatchObject({
      connectionBackfillComplete: false,
      connectionBackfillStart: 300,
      connectionSyncRevision: LINKEDIN_CONNECTION_SYNC_REVISION,
    });

    const callsBeforeRetry = mocks.fetchConnectionsPage.mock.calls.length;

    await syncLinkedInConnectionsAndInvitations(
      OWNER_LINKEDIN_ID,
      RUN_STARTED_AT + 1,
      createProgress(),
    );

    expect(getRequestedConnectionStarts(callsBeforeRetry)).toEqual([
      0, 200, 300,
    ]);
    await expect(
      getLinkedInSyncState(OWNER_LINKEDIN_ID),
    ).resolves.toMatchObject({
      connectionBackfillComplete: true,
      connectionBackfillStart: 0,
      connectionSyncRevision: LINKEDIN_CONNECTION_SYNC_REVISION,
    });
  });

  it('retains incremental early termination after the revision backfill completes', async () => {
    seedSyncState({
      connectionBackfillComplete: true,
      connectionBackfillStart: 0,
      connectionSyncRevision: LINKEDIN_CONNECTION_SYNC_REVISION,
    });
    mocks.fetchConnectionsPage.mockResolvedValue(connectionPage(0, true, 100));
    mocks.writeLinkedInConnections.mockResolvedValue({
      received: 1,
      alreadyKnown: 50,
    });

    await syncLinkedInConnectionsAndInvitations(
      OWNER_LINKEDIN_ID,
      RUN_STARTED_AT,
      createProgress(),
    );

    expect(getRequestedConnectionStarts()).toEqual([0]);
  });
});
