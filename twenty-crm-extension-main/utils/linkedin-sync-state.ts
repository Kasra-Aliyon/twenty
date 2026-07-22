import type { LinkedInIdentity, LinkedInSyncState } from '../types';

const LINKEDIN_HARVEST_ENABLED_KEY = 'twentyLinkedinHarvestEnabled';
const LINKEDIN_SYNC_STATE_KEY_PREFIX = 'twentyLinkedinSyncState:';
const LINKEDIN_IDENTITY_CACHE_KEY = 'twentyLinkedinIdentityCache';

export const LINKEDIN_MESSAGE_SYNC_REVISION = 3;
export const LINKEDIN_INVITATION_SYNC_REVISION = 1;

const defaultLinkedInSyncState = (): LinkedInSyncState => ({
  safeSyncedThroughLastActivityAt: null,
  historicalBackfillComplete: false,
  invitationSyncRevision: 0,
  messageSyncRevision: 0,
  lastConnectionSyncAt: null,
  lastMessageSyncAt: null,
  lastRunAt: null,
  syncStartedAt: null,
  lastError: null,
});

const getStateKey = (linkedinId: string) =>
  `${LINKEDIN_SYNC_STATE_KEY_PREFIX}${linkedinId}`;

export const getLinkedInHarvestEnabled = async (): Promise<boolean> => {
  const storedValue = await browser.storage.local.get(
    LINKEDIN_HARVEST_ENABLED_KEY,
  );

  return storedValue[LINKEDIN_HARVEST_ENABLED_KEY] === true;
};

export const setLinkedInHarvestEnabled = async (
  enabled: boolean,
): Promise<void> => {
  await browser.storage.local.set({ [LINKEDIN_HARVEST_ENABLED_KEY]: enabled });
};

export const getCachedLinkedInIdentity =
  async (): Promise<LinkedInIdentity | null> => {
    const storedValue = await browser.storage.local.get(
      LINKEDIN_IDENTITY_CACHE_KEY,
    );
    const identity = storedValue[LINKEDIN_IDENTITY_CACHE_KEY] as
      | LinkedInIdentity
      | undefined;
    const pageMemberId = document
      .querySelector<HTMLMetaElement>('meta[name="__init"]')
      ?.content.match(/urn:li:member:(\d+)/)?.[1];

    if (!identity || (pageMemberId && identity.linkedinId !== pageMemberId)) {
      return null;
    }

    return identity;
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

  return {
    ...defaultLinkedInSyncState(),
    ...(storedValue[key] as Partial<LinkedInSyncState> | undefined),
  };
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
