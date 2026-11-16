import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { LinkedInIdentity } from '../../types';
import type { LinkedInHarvestStore } from '../linkedin-harvest-store';

const mocks = vi.hoisted(() => ({ fetchMessageThreadsPage: vi.fn() }));

vi.mock('../linkedin-voyager-client', () => ({
  linkedInVoyagerClient: {
    fetchMessageThreadsPage: mocks.fetchMessageThreadsPage,
  },
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

import { syncRecentLinkedInMessages } from '../linkedin-sync-messages';
import {
  getLinkedInSyncState,
  LINKEDIN_MESSAGE_SYNC_REVISION,
  updateLinkedInSyncState,
} from '../linkedin-sync-state';

const identity: LinkedInIdentity = {
  linkedinId: '123',
  linkedinUrn: 'ACoOwner',
  handle: 'owner',
  name: 'Owner User',
};
const checkpoint = Date.parse('2026-11-13T08:20:30.850Z');
const store = {} as LinkedInHarvestStore;
const progress = { connections: 0, invitations: 0, threads: 0, messages: 0 };

beforeEach(async () => {
  const values = new Map<string, unknown>();
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items))
            values.set(key, value);
        },
      },
    },
  });
  await updateLinkedInSyncState(identity.linkedinId, {
    messageSyncRevision: LINKEDIN_MESSAGE_SYNC_REVISION,
    safeSyncedThroughLastActivityAt: checkpoint,
  });
});

afterEach(() => vi.unstubAllGlobals());

it('fails instead of keeping a stale checkpoint when an already-synced inbox comes back empty', async () => {
  mocks.fetchMessageThreadsPage.mockResolvedValue({
    elements: [],
    hasMore: false,
    threadPaginationMode: 'timestamp',
  });

  await expect(
    syncRecentLinkedInMessages(store, identity, progress),
  ).rejects.toThrow('LinkedIn returned an empty inbox');
  expect(
    (await getLinkedInSyncState(identity.linkedinId))
      .safeSyncedThroughLastActivityAt,
  ).toBe(checkpoint);
});
