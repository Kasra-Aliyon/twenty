import type {
  LinkedInIdentity,
  LinkedInSyncState,
  LinkedInSyncStatus,
} from '../types';

const LINKEDIN_SYNC_STATE_KEY_PREFIX = 'twentyLinkedinSyncState:';
export const LINKEDIN_IDENTITY_CACHE_KEY = 'twentyLinkedinIdentityCache';

export const LINKEDIN_CONNECTION_SYNC_REVISION = 1;
export const LINKEDIN_MESSAGE_SYNC_REVISION = 4;
export const LINKEDIN_INVITATION_SYNC_REVISION = 2;
// LinkedIn reads are capped at 200 per rolling day. Each message check costs one
// read, so the cadences below leave roughly a quarter of that budget for
// downloading the threads that actually changed.
export const LINKEDIN_SYNC_INTERVAL_MINUTES = 15;
export const LINKEDIN_CONNECTION_SYNC_INTERVAL_MINUTES = 60;
export const LINKEDIN_MAINTENANCE_INTERVAL_MINUTES = 120;
export const LINKEDIN_IDENTITY_REVALIDATION_MILLISECONDS = 24 * 60 * 60_000;

export type CachedLinkedInIdentity = LinkedInIdentity & {
  verifiedAt?: number;
  sessionFingerprint?: string | null;
};

const defaultLinkedInSyncState = (): LinkedInSyncState => ({
  safeSyncedThroughLastActivityAt: null,
  historicalBackfillComplete: false,
  connectionBackfillComplete: false,
  connectionBackfillStart: 0,
  connectionSyncRevision: 0,
  invitationSyncRevision: 0,
  messageSyncRevision: 0,
  lastConnectionSyncAt: null,
  lastMessageSyncAt: null,
  lastAttemptAt: null,
  lastInvitationAttemptAt: null,
  lastMessageBackfillAttemptAt: null,
  messageRepairCursor: null,
  lastRunAt: null,
  syncStartedAt: null,
  lastError: null,
});

const getStateKey = (linkedinId: string) =>
  `${LINKEDIN_SYNC_STATE_KEY_PREFIX}${linkedinId}`;

export const emptyLinkedInSyncStatus = (): LinkedInSyncStatus => ({
  running: false,
  isError: false,
  message: 'Waiting for the next automatic sync.',
  lastRunAt: null,
  progress: { connections: 0, invitations: 0, threads: 0, messages: 0 },
});

export const getStoredLinkedInIdentity =
  async (): Promise<CachedLinkedInIdentity | null> => {
    const storedValue = await browser.storage.local.get(
      LINKEDIN_IDENTITY_CACHE_KEY,
    );

    return (
      (storedValue[LINKEDIN_IDENTITY_CACHE_KEY] as
        | CachedLinkedInIdentity
        | undefined) ?? null
    );
  };

export const setCachedLinkedInIdentity = async (
  identity: CachedLinkedInIdentity,
): Promise<void> => {
  await browser.storage.local.set({ [LINKEDIN_IDENTITY_CACHE_KEY]: identity });
};

export const getLinkedInSyncState = async (
  linkedinId: string,
): Promise<LinkedInSyncState> => {
  const key = getStateKey(linkedinId);
  const storedValue = await browser.storage.local.get(key);
  const storedState = storedValue[key] as
    | Partial<LinkedInSyncState>
    | undefined;
  const state = {
    ...defaultLinkedInSyncState(),
    ...storedState,
  };

  return state;
};

export const updateLinkedInSyncState = async (
  linkedinId: string,
  update: Partial<LinkedInSyncState>,
): Promise<LinkedInSyncState> => {
  const nextState = {
    ...(await getLinkedInSyncState(linkedinId)),
    ...update,
  };

  await browser.storage.local.set({ [getStateKey(linkedinId)]: nextState });

  return nextState;
};
