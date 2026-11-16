import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TwentyApiClient } from '../twenty-api';

const mocks = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  getSessionFingerprint: vi.fn(),
  initialize: vi.fn(),
  syncConnections: vi.fn(),
  syncMessages: vi.fn(),
  syncInvitations: vi.fn(),
  backfillConnections: vi.fn(),
  backfillMessages: vi.fn(),
  getStore: vi.fn(),
}));

vi.mock('../twenty-session', () => ({
  TWENTY_SIGN_IN_REQUIRED: 'Sign in to Twenty.',
}));

vi.mock('../linkedin-voyager-client', () => ({
  linkedInVoyagerClient: {
    initialize: mocks.initialize,
    getIdentity: mocks.getIdentity,
    getSessionFingerprint: mocks.getSessionFingerprint,
  },
  LinkedInSyncTimeLimitError: class extends Error {},
}));

vi.mock('../linkedin-sync-connections', () => ({
  syncRecentLinkedInConnections: mocks.syncConnections,
  syncLinkedInInvitations: mocks.syncInvitations,
  backfillLinkedInConnections: mocks.backfillConnections,
}));

vi.mock('../linkedin-sync-messages', () => ({
  syncRecentLinkedInMessages: mocks.syncMessages,
  backfillLinkedInMessages: mocks.backfillMessages,
}));

import { createLinkedInBackgroundSync } from '../linkedin-background-sync';
import { createLinkedInHarvestStore } from '../linkedin-harvest-store';
import { getLinkedInSyncState } from '../linkedin-sync-state';

describe('LinkedIn background sync', () => {
  const client = { graphqlRequest: vi.fn() } as unknown as TwentyApiClient;
  const readInvitationPage = vi.fn().mockResolvedValue([]);
  const owner = {
    linkedinId: 'linked-in-member',
    linkedinUrn: 'linked-in-profile',
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.getStore.mockResolvedValue(createLinkedInHarvestStore(client));
    mocks.getIdentity.mockResolvedValue(owner);
    mocks.getSessionFingerprint.mockReturnValue('session-a');
    mocks.syncInvitations.mockResolvedValue({ warnings: [] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('syncs on schedule without any tab APIs and coalesces overlapping requests', async () => {
    const sync = createLinkedInBackgroundSync(
      mocks.getStore,
      readInvitationPage,
    );

    await Promise.all([sync.run(), sync.run(true)]);
    await sync.run();

    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.syncConnections).toHaveBeenCalledTimes(1);
    expect(mocks.syncMessages).toHaveBeenCalledTimes(1);
    expect(mocks.syncMessages).toHaveBeenCalledBefore(mocks.syncInvitations);
    expect(mocks.syncMessages).toHaveBeenCalledBefore(mocks.backfillMessages);
    expect(await sync.getStatus()).toMatchObject({
      running: false,
      isError: false,
    });
    expect(
      (await getLinkedInSyncState(owner.linkedinId)).lastRunAt,
    ).toBeGreaterThan(0);
  });

  it('checks Twenty authentication before accessing LinkedIn', async () => {
    mocks.getStore.mockRejectedValueOnce(new Error('Sign in to Twenty.'));
    const sync = createLinkedInBackgroundSync(
      mocks.getStore,
      readInvitationPage,
    );

    await sync.run();

    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(await sync.getStatus()).toMatchObject({
      running: false,
      isError: true,
      message: 'Sign in to Twenty.',
    });
    const restarted = createLinkedInBackgroundSync(
      mocks.getStore,
      readInvitationPage,
    );
    expect(await restarted.getStatus()).toMatchObject({
      running: false,
      isError: true,
      message: 'Sign in to Twenty.',
    });
  });
  it('reuses the verified identity for the same LinkedIn session and paces connection checks', async () => {
    const sync = createLinkedInBackgroundSync(
      mocks.getStore,
      readInvitationPage,
    );
    const startedAt = Date.now();
    const nowSpy = vi.spyOn(Date, 'now');

    try {
      nowSpy.mockReturnValue(startedAt);
      await sync.run();
      nowSpy.mockReturnValue(startedAt + 15 * 60_000);
      await sync.run();

      expect(mocks.getIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.syncMessages).toHaveBeenCalledTimes(2);
      expect(mocks.syncConnections).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(startedAt + 60 * 60_000);
      mocks.getSessionFingerprint.mockReturnValue('session-b');
      await sync.run();

      expect(mocks.getIdentity).toHaveBeenCalledTimes(2);
      expect(mocks.syncMessages).toHaveBeenCalledTimes(3);
      expect(mocks.syncConnections).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('reports a failed message check instead of claiming the sync completed', async () => {
    mocks.syncMessages.mockRejectedValueOnce(
      new Error('LinkedIn returned an empty inbox.'),
    );
    const sync = createLinkedInBackgroundSync(
      mocks.getStore,
      readInvitationPage,
    );

    await sync.run(true);

    expect(await sync.getStatus()).toMatchObject({
      isError: true,
      message: 'LinkedIn returned an empty inbox.',
    });
    expect(
      (await getLinkedInSyncState(owner.linkedinId)).lastMessageSyncAt,
    ).toBeNull();
  });
});
