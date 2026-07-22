import type { LinkedInIdentity, LinkedInSyncState } from '../types';

const LINKEDIN_SYNC_STATE_KEY_PREFIX = 'twentyLinkedinSyncState:';
export const LINKEDIN_IDENTITY_CACHE_KEY = 'twentyLinkedinIdentityCache';

export const LINKEDIN_CONNECTION_SYNC_REVISION = 1;
export const LINKEDIN_MESSAGE_SYNC_REVISION = 4;
export const LINKEDIN_INVITATION_SYNC_REVISION = 2;

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
  lastRunAt: null,
  syncStartedAt: null,
  lastError: null,
});

const getStateKey = (linkedinId: string) =>
  `${LINKEDIN_SYNC_STATE_KEY_PREFIX}${linkedinId}`;

export const getCachedLinkedInIdentity =
  async (): Promise<LinkedInIdentity | null> => {
    const identity = await getStoredLinkedInIdentity();
    const pageMemberId = document
      .querySelector<HTMLMetaElement>('meta[name="__init"]')
      ?.content.match(/urn:li:member:(\d+)/)?.[1];

    if (!identity || (pageMemberId && identity.linkedinId !== pageMemberId)) {
      return null;
    }

    return identity;
  };

export const getStoredLinkedInIdentity =
  async (): Promise<LinkedInIdentity | null> => {
    const storedValue = await browser.storage.local.get(
      LINKEDIN_IDENTITY_CACHE_KEY,
    );

    return (
      (storedValue[LINKEDIN_IDENTITY_CACHE_KEY] as
        | LinkedInIdentity
        | undefined) ?? null
    );
  };

export const setCachedLinkedInIdentity = async (
  identity: LinkedInIdentity,
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
