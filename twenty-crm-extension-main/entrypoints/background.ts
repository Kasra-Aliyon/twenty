import { TwentyApiClient } from '../utils/twenty-api';
import {
  getTwentyAccessToken,
  syncTwentyBrowserSession,
  TWENTY_SIGN_IN_REQUIRED,
  withTwentySessionOperation,
} from '../utils/twenty-session';
import {
  claimAction,
  fetchDueActions,
  fetchLinkedinActionById,
  fetchLinkedinActionQueue,
  releaseActionClaim,
  reportAction,
  startActionClaim,
} from '../utils/linkedin-actions-api';
import {
  getSettings,
  saveSettings,
  addToRecentCaptures,
  getRecentCaptures,
  getTwentyTokenPair,
} from '../utils/storage';
import {
  getLinkedInSyncTotalsWithClient,
  createLinkedInHarvestStore,
} from '../utils/linkedin-harvest-store';
import {
  getLinkedInSafetySettings,
  getLinkedInSafetySnapshot,
  recordLinkedInOutboundAttempt,
  setLinkedInSafetySettings,
  tripLinkedInSafetyCircuit,
} from '../utils/linkedin-safety';
import {
  getStoredLinkedInIdentity,
  LINKEDIN_SYNC_INTERVAL_MINUTES,
  getLinkedInSyncState,
} from '../utils/linkedin-sync-state';
import {
  canRecoverLinkedInActionAfterInterruption,
  createSerializedLinkedinRunnerOperation,
  getLinkedinRunnerActionOwnershipError,
  getLinkedinRunnerClaimError,
  getLinkedinRunnerEnableError,
  getRunnerStateAfterEnable,
  getRunnerStateAfterPause,
  getRunnerStateAfterTabRemoval,
  reconcileRunnerActionOnEnable,
  reconcileRunnerReleaseOnEnable,
  releaseRunnerActionBeforeProviderStart,
  resolveRunnerActionReport,
  resolveRunnerProviderStart,
} from '../utils/linkedin-runner-state';
import { createLinkedInBackgroundSync } from '../utils/linkedin-background-sync';
import type {
  ExtensionMessage,
  ExtensionResponse,
  ExtensionSettings,
  LinkedInProfileData,
  LinkedInCompanyData,
  TwentyTokenPair,
  LinkedInActionStatus,
  LinkedInConnectionState,
  LinkedInRunnerSessionState,
  LinkedInSafetySettings,
  LinkedInHarvestInvitation,
  TwentyLinkedInAction,
} from '../types';

const LINKEDIN_RUNNER_ALARM = 'twenty-linkedin-runner-poll';
const LINKEDIN_SYNC_ALARM = 'twenty-linkedin-automatic-sync';
const LINKEDIN_RUNNER_STATE_KEY = 'twentyLinkedinRunnerState';
const withLinkedinRunnerStateOperation =
  createSerializedLinkedinRunnerOperation();

const ensurePeriodicAlarm = async (
  name: string,
  periodInMinutes: number,
): Promise<void> => {
  if ((await browser.alarms.get(name))?.periodInMinutes !== periodInMinutes) {
    await browser.alarms.create(name, { periodInMinutes });
  }
};

const readReceivedInvitations = async (): Promise<
  LinkedInHarvestInvitation[]
> => {
  const tabs = await browser.tabs.query({
    url: 'https://www.linkedin.com/mynetwork/invitation-manager/*',
  });
  const tab = tabs.find(
    ({ id, discarded, url }) =>
      id !== undefined && !discarded && !url?.includes('/sent'),
  );
  if (tab?.id === undefined) return [];

  const records = await browser.tabs
    .sendMessage(tab.id, {
      type: 'READ_LINKEDIN_INVITATIONS_PAGE',
    })
    .catch(() => null);

  return Array.isArray(records) ? records : [];
};

const DEFAULT_LINKEDIN_RUNNER_STATE: LinkedInRunnerSessionState = {
  enabled: false,
  tabId: null,
  activeAction: null,
  activeActionStartedAt: null,
  activeActionNeedsRelease: false,
  activeActionNeedsReconciliation: false,
  lastExecutedAt: null,
  completedCount: 0,
  failedCount: 0,
};

const getLinkedinRunnerState =
  async (): Promise<LinkedInRunnerSessionState> => {
    const storedState = await browser.storage.session.get(
      LINKEDIN_RUNNER_STATE_KEY,
    );

    return {
      ...DEFAULT_LINKEDIN_RUNNER_STATE,
      ...(storedState[LINKEDIN_RUNNER_STATE_KEY] as
        | Partial<LinkedInRunnerSessionState>
        | undefined),
    };
  };

const setLinkedinRunnerState = async (
  state: LinkedInRunnerSessionState,
): Promise<void> => {
  await browser.storage.session.set({ [LINKEDIN_RUNNER_STATE_KEY]: state });
};

const handleLinkedinRunnerTabRemovedWithoutLock = async (
  tabId: number,
): Promise<void> => {
  const runnerState = await getLinkedinRunnerState();

  if (runnerState.tabId !== tabId) {
    return;
  }

  const didStartAction =
    runnerState.activeAction !== null &&
    runnerState.activeActionStartedAt !== null;
  let reportedInterruptedAction: TwentyLinkedInAction | null = null;
  let unstartedClaimHandled = false;

  if (!didStartAction && runnerState.activeAction) {
    try {
      const client = await getApiClient();
      const { claimedAt, claimedBy, id } = runnerState.activeAction;

      if (!claimedAt || !claimedBy) {
        throw new Error('The unstarted action did not have a complete claim');
      }

      // The browser definitively did not begin this action. Return its lease
      // instead of letting expiry misclassify a direct message as unknown.
      const releasedAction = await releaseActionClaim(
        client,
        id,
        claimedBy,
        claimedAt,
      );

      unstartedClaimHandled = releasedAction !== null;
    } catch (error) {
      console.error(
        '[Twenty] Could not release the unstarted LinkedIn action:',
        error,
      );
    }
  }

  if (
    didStartAction &&
    runnerState.activeAction &&
    !canRecoverLinkedInActionAfterInterruption(runnerState.activeAction.type)
  ) {
    try {
      const client = await getApiClient();
      const claimedAt = runnerState.activeAction.claimedAt;
      const claimedBy = runnerState.activeAction.claimedBy;

      if (!claimedAt || !claimedBy) {
        throw new Error('The interrupted action did not have a complete claim');
      }

      reportedInterruptedAction = await reportAction(
        client,
        runnerState.activeAction.id,
        claimedBy,
        claimedAt,
        {
          status: 'FAILED',
          connectionState: 'UNKNOWN',
          errorMessage:
            'The runner tab closed after this action began, so its outcome is unknown.',
        },
      );
    } catch (error) {
      console.error(
        '[Twenty] Could not report the interrupted LinkedIn action:',
        error,
      );
    }
  }

  await setLinkedinRunnerState(
    getRunnerStateAfterTabRemoval({
      runnerState,
      reportedInterruptedAction,
      unstartedClaimHandled,
    }),
  );
};

const handleLinkedinRunnerTabRemoved = (tabId: number): Promise<void> =>
  withLinkedinRunnerStateOperation(() =>
    handleLinkedinRunnerTabRemovedWithoutLock(tabId),
  );

// Cache for API client
async function getApiClient(): Promise<TwentyApiClient> {
  const settings = await getSettings();
  const token = await getAuthToken(settings);

  if (!token) throw new Error(TWENTY_SIGN_IN_REQUIRED);

  const client = new TwentyApiClient(
    settings.twentyApiUrl,
    async (rejectedToken) => {
      const renewedToken = await getAuthToken(settings, rejectedToken);

      if (!renewedToken) throw new Error(TWENTY_SIGN_IN_REQUIRED);

      return renewedToken;
    },
  );
  client.setToken(token);
  return client;
}

function isValidTwentyTokenPair(payload: unknown): payload is TwentyTokenPair {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const tokenPair = payload as Partial<TwentyTokenPair>;

  return (
    typeof tokenPair.accessOrWorkspaceAgnosticToken?.token === 'string' &&
    tokenPair.accessOrWorkspaceAgnosticToken.token.length > 0
  );
}

function parseTokenPair(rawTokenPair: string | null): TwentyTokenPair | null {
  if (!rawTokenPair) {
    return null;
  }

  try {
    const tokenPair = JSON.parse(rawTokenPair);

    return isValidTwentyTokenPair(tokenPair) ? tokenPair : null;
  } catch {
    return null;
  }
}

function haveSameOrigin(firstUrl: string, secondUrl: string): boolean {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

async function readTwentyTabSession(
  tabId: number,
  origin: string,
): Promise<TwentyTokenPair | null> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: (expectedOrigin) =>
      location.origin === expectedOrigin
        ? localStorage.getItem('tokenPairState')
        : null,
    args: [origin],
  });

  return parseTokenPair(results[0]?.result ?? null);
}

async function syncTokenPairFromActiveTab(): Promise<boolean> {
  const settings = await getSettings();
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const activeTab = tabs[0];

  if (!activeTab?.id || !activeTab.url) {
    console.log('No active tab available for Twenty token sync');
    return false;
  }

  if (!haveSameOrigin(activeTab.url, settings.twentyAppUrl)) {
    console.log(
      'Active tab is not the configured Twenty app URL:',
      activeTab.url,
      settings.twentyAppUrl,
    );
    return false;
  }

  try {
    const tokenPair = await readTwentyTabSession(
      activeTab.id,
      new URL(settings.twentyAppUrl).origin,
    );

    await withTwentySessionOperation(async () => {
      const currentSettings = await getSettings();
      if (!haveSameOrigin(activeTab.url!, currentSettings.twentyAppUrl)) {
        throw new Error('The selected CRM changed during token sync');
      }
      await syncTwentyBrowserSession(currentSettings, tokenPair);
    });

    console.log(
      'Active tab Twenty token sync:',
      tokenPair ? 'synced' : 'no token found',
    );

    return isValidTwentyTokenPair(await getTwentyTokenPair());
  } catch (error) {
    console.error('Failed to sync token from active Twenty tab:', error);
    return false;
  }
}

async function readTwentyBrowserSession(
  settings: ExtensionSettings,
): Promise<TwentyTokenPair | null> {
  const appUrl = new URL(settings.twentyAppUrl);
  // Match patterns omit the port. Recheck the exact origin before and during injection.
  const tabs = await browser.tabs.query({
    url: `${appUrl.protocol}//${appUrl.hostname}/*`,
  });

  for (const tab of tabs) {
    if (
      tab.id === undefined ||
      tab.discarded ||
      !tab.url ||
      !haveSameOrigin(tab.url, appUrl.origin)
    )
      continue;

    const tokens = await readTwentyTabSession(tab.id, appUrl.origin).catch(
      () => null,
    );
    if (tokens) return tokens;
  }

  const cookie = await browser.cookies
    .get({ url: appUrl.origin, name: 'tokenPair' })
    .catch(() => null);
  return cookie ? parseTokenPair(decodeURIComponent(cookie.value)) : null;
}

async function getAuthToken(
  settings: ExtensionSettings,
  rejectedToken?: string,
): Promise<string | null> {
  return getTwentyAccessToken(
    settings,
    () => readTwentyBrowserSession(settings),
    rejectedToken,
  );
}

async function getLinkedInSyncStore() {
  const client = await getApiClient();
  const result = await client.metadataRequest<{
    currentUser: { id: string } | null;
  }>('query LinkedInSyncSession { currentUser { id } }');

  if (!result.data?.currentUser?.id) throw new Error(TWENTY_SIGN_IN_REQUIRED);
  return createLinkedInHarvestStore(client);
}

const linkedInSync = createLinkedInBackgroundSync(
  getLinkedInSyncStore,
  readReceivedInvitations,
);

// Check if a person already exists (by LinkedIn URL or name)
async function checkPersonDuplicate(
  client: TwentyApiClient,
  linkedinUrl: string,
  firstName?: string,
  lastName?: string,
): Promise<{
  exists: boolean;
  record?: { id: string; type: string };
  matchedBy?: string;
}> {
  // First, try to find by LinkedIn URL
  try {
    const personByLinkedIn = await client.findPersonByLinkedInUrl(linkedinUrl);
    if (personByLinkedIn) {
      console.log('Found person by LinkedIn URL:', personByLinkedIn.id);
      return {
        exists: true,
        record: { id: personByLinkedIn.id, type: 'person' },
        matchedBy: 'linkedin',
      };
    }
  } catch (error) {
    console.error('Error searching by LinkedIn URL:', error);
  }

  // If not found by LinkedIn URL and we have name, try by name
  if (firstName && lastName) {
    try {
      const personByName = await client.findPersonByName(firstName, lastName);
      if (personByName) {
        console.log(
          'Found person by name:',
          personByName.id,
          personByName.name,
        );
        return {
          exists: true,
          record: { id: personByName.id, type: 'person' },
          matchedBy: 'name',
        };
      }
    } catch (error) {
      console.error('Error searching by name:', error);
    }
  }

  return { exists: false };
}

// Check if a company already exists (by LinkedIn URL or name)
async function checkCompanyDuplicate(
  client: TwentyApiClient,
  linkedinUrl: string,
  companyName?: string,
): Promise<{
  exists: boolean;
  record?: { id: string; type: string };
  matchedBy?: string;
}> {
  // First, try to find by LinkedIn URL
  try {
    const companyByLinkedIn =
      await client.findCompanyByLinkedInUrl(linkedinUrl);
    if (companyByLinkedIn) {
      console.log('Found company by LinkedIn URL:', companyByLinkedIn.id);
      return {
        exists: true,
        record: { id: companyByLinkedIn.id, type: 'company' },
        matchedBy: 'linkedin',
      };
    }
  } catch (error) {
    console.error('Error searching company by LinkedIn URL:', error);
  }

  // If not found by LinkedIn URL and we have name, try by name
  if (companyName) {
    try {
      const companyByName = await client.findCompanyByName(companyName);
      if (companyByName) {
        console.log(
          'Found company by name:',
          companyByName.id,
          companyByName.name,
        );
        return {
          exists: true,
          record: { id: companyByName.id, type: 'company' },
          matchedBy: 'name',
        };
      }
    } catch (error) {
      console.error('Error searching company by name:', error);
    }
  }

  return { exists: false };
}

// Check if a record already exists (broader matching)
async function checkDuplicate(
  linkedinUrl: string,
  pageType: 'person' | 'company',
  scrapedData?: LinkedInProfileData | LinkedInCompanyData,
): Promise<{
  exists: boolean;
  record?: { id: string; type: string };
  matchedBy?: string;
}> {
  const client = await getApiClient();

  if (pageType === 'person') {
    const personData = scrapedData as LinkedInProfileData | undefined;
    return checkPersonDuplicate(
      client,
      linkedinUrl,
      personData?.firstName,
      personData?.lastName,
    );
  } else {
    const companyData = scrapedData as LinkedInCompanyData | undefined;
    return checkCompanyDuplicate(client, linkedinUrl, companyData?.name);
  }
}

// Create a new record
async function createRecord(
  data: LinkedInProfileData | LinkedInCompanyData,
): Promise<{ id: string }> {
  const client = await getApiClient();

  if (data.type === 'person') {
    const person = await client.createPerson(data);

    // Save to recent captures
    await addToRecentCaptures({
      linkedinUrl: data.linkedinUrl,
      name: `${data.firstName} ${data.lastName}`,
      type: 'person',
      twentyId: person.id,
    });

    return { id: person.id };
  } else {
    const company = await client.createCompany(data);

    // Save to recent captures
    await addToRecentCaptures({
      linkedinUrl: data.linkedinUrl,
      name: data.name,
      type: 'company',
      twentyId: company.id,
    });

    return { id: company.id };
  }
}

// Test connection to Twenty
async function testConnection(): Promise<boolean> {
  try {
    const client = await getApiClient();
    return await client.testConnection();
  } catch (err) {
    console.error('Test connection failed:', err);
    return false;
  }
}

// Handle messages
async function handleMessage(
  message: ExtensionMessage,
  sender?: { url?: string; tab?: { id?: number; url?: string } },
): Promise<ExtensionResponse> {
  console.log('Received message:', message.type);

  try {
    if (
      message.type === 'SYNC_TWENTY_TOKEN_PAIR' ||
      message.type === 'SYNC_LINKEDIN_SAFETY_SETTINGS'
    ) {
      const settings = await getSettings();
      const senderUrl = sender?.url;

      // Local and production tabs can be open together; only the selected CRM owns this session.
      if (!senderUrl || !haveSameOrigin(senderUrl, settings.twentyAppUrl)) {
        return {
          success: false,
          error: 'Token bridge origin is not the configured Twenty app',
        };
      }
    }

    switch (message.type) {
      case 'SYNC_TWENTY_TOKEN_PAIR': {
        const tokenPair = message.payload as TwentyTokenPair | null;
        const hasValidTokenPair = isValidTwentyTokenPair(tokenPair);

        console.log(
          'Twenty token sync payload:',
          hasValidTokenPair ? 'valid token pair' : 'no valid token pair',
        );

        await withTwentySessionOperation(async () => {
          const settings = await getSettings();
          if (
            !sender?.url ||
            !haveSameOrigin(sender.url, settings.twentyAppUrl)
          ) {
            throw new Error(
              'Token bridge origin is not the configured Twenty app',
            );
          }
          await syncTwentyBrowserSession(
            settings,
            hasValidTokenPair ? tokenPair : null,
          );
        });

        return { success: true };
      }

      case 'SYNC_LINKEDIN_SAFETY_SETTINGS':
        return {
          success: true,
          data: await setLinkedInSafetySettings(
            message.payload as Partial<LinkedInSafetySettings>,
          ),
        };

      case 'SYNC_TWENTY_TOKEN_PAIR_FROM_ACTIVE_TAB': {
        const hasToken = await syncTokenPairFromActiveTab();

        return { success: true, data: { hasToken } };
      }

      case 'GET_AUTH_TOKEN': {
        const settings = await getSettings();
        if (!settings.twentyApiUrl) {
          return { success: false, error: 'Twenty API URL not configured' };
        }
        const token = await getAuthToken(settings);
        return { success: !!token, data: { hasToken: !!token } };
      }

      case 'CHECK_DUPLICATE': {
        const { linkedinUrl, pageType, scrapedData } = message.payload as {
          linkedinUrl: string;
          pageType: 'person' | 'company';
          scrapedData?: LinkedInProfileData | LinkedInCompanyData;
        };
        const result = await checkDuplicate(linkedinUrl, pageType, scrapedData);
        return { success: true, data: result };
      }

      case 'CREATE_RECORD': {
        const data = message.payload as
          | LinkedInProfileData
          | LinkedInCompanyData;
        const result = await createRecord(data);
        return { success: true, data: result };
      }

      case 'GET_SETTINGS': {
        const settings = await getSettings();
        const hasToken = settings.twentyApiUrl
          ? !!(await getAuthToken(settings).catch(() => null))
          : false;
        return {
          success: true,
          data: { ...settings, hasToken },
        };
      }

      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as Partial<ExtensionSettings>;
        console.log('Saving settings:', newSettings);
        await withTwentySessionOperation(() => saveSettings(newSettings));
        console.log('Settings saved successfully');
        return { success: true };
      }

      case 'TEST_CONNECTION': {
        const connected = await testConnection();
        return { success: true, data: { connected } };
      }

      case 'GET_RECENT_CAPTURES': {
        const captures = await getRecentCaptures();
        return { success: true, data: captures };
      }

      case 'SEARCH_RECORDS': {
        const { query, type } = message.payload as {
          query: string;
          type: 'person' | 'company';
        };
        const client = await getApiClient();
        const results = await client.searchRecords(query, type);
        return { success: true, data: results };
      }

      case 'GET_RECORD_LISTS': {
        const { recordType } = message.payload as {
          recordType: 'person' | 'company';
        };
        const client = await getApiClient();

        try {
          const lists = await client.findRecordLists(recordType);

          return { success: true, data: { lists, isAvailable: true } };
        } catch (error) {
          console.warn('[Twenty] Record lists are not available:', error);

          return {
            success: true,
            data: { lists: [], isAvailable: false },
          };
        }
      }

      case 'CREATE_RECORD_LIST': {
        const { name, recordType } = message.payload as {
          name: string;
          recordType: 'person' | 'company';
        };
        const client = await getApiClient();
        const recordList = await client.createRecordList(name, recordType);

        return { success: true, data: recordList };
      }

      case 'ADD_TO_RECORD_LISTS': {
        const { recordId, recordType, recordListIds } = message.payload as {
          recordId: string;
          recordType: 'person' | 'company';
          recordListIds: string[];
        };
        const client = await getApiClient();

        await client.createRecordListMembers({
          recordId,
          recordType,
          recordListIds,
        });

        return { success: true };
      }

      case 'FETCH_DUE_LINKEDIN_ACTIONS': {
        const client = await getApiClient();
        const actions = await fetchDueActions(client);

        return { success: true, data: actions };
      }

      case 'FETCH_LINKEDIN_ACTION_QUEUE': {
        const client = await getApiClient();
        const actions = await fetchLinkedinActionQueue(client);

        return { success: true, data: actions };
      }

      case 'CLAIM_LINKEDIN_ACTION': {
        const { id } = message.payload as { id: string };
        const tabId = sender?.tab?.id;

        return await withLinkedinRunnerStateOperation(async () => {
          const runnerState = await getLinkedinRunnerState();
          const claimError = getLinkedinRunnerClaimError(runnerState, tabId);

          if (claimError) {
            return { success: false, error: claimError };
          }

          const client = await getApiClient();
          const action = await claimAction(
            client,
            id,
            `extension-tab-${tabId}`,
          );

          if (!action) {
            return { success: true, data: null };
          }

          await setLinkedinRunnerState({
            ...runnerState,
            activeAction: action,
            activeActionStartedAt: null,
            activeActionNeedsRelease: false,
            activeActionNeedsReconciliation: false,
          });

          return { success: true, data: action };
        });
      }

      case 'REPORT_LINKEDIN_ACTION': {
        const { id, claimedAt, status, connectionState, errorMessage } =
          message.payload as {
            id: string;
            claimedAt: string;
            status: Extract<
              LinkedInActionStatus,
              'COMPLETED' | 'SKIPPED' | 'FAILED'
            >;
            connectionState: LinkedInConnectionState;
            errorMessage?: string | null;
          };
        const tabId = sender?.tab?.id;

        return await withLinkedinRunnerStateOperation(async () => {
          const runnerState = await getLinkedinRunnerState();
          const ownershipError = getLinkedinRunnerActionOwnershipError({
            runnerState,
            tabId,
            actionId: id,
            claimedAt,
            requireEnabled: false,
          });

          if (ownershipError) {
            return { success: false, error: ownershipError };
          }

          const client = await getApiClient();
          const claimedBy = runnerState.activeAction?.claimedBy;

          if (!claimedBy) {
            return {
              success: false,
              error: 'The active action did not include its claim owner',
            };
          }

          const action = await reportAction(client, id, claimedBy, claimedAt, {
            status,
            connectionState,
            errorMessage,
          });
          const reportResolution = resolveRunnerActionReport({
            runnerState,
            reportedAction: action,
          });

          await setLinkedinRunnerState(reportResolution.runnerState);

          if (!action) {
            return {
              success: false,
              error: reportResolution.error ?? undefined,
            };
          }

          return { success: true, data: action };
        });
      }

      case 'MARK_LINKEDIN_ACTION_EXECUTING': {
        const { id, claimedAt } = message.payload as {
          id: string;
          claimedAt: string | null;
        };
        const tabId = sender?.tab?.id;

        return await withLinkedinRunnerStateOperation(async () => {
          const runnerState = await getLinkedinRunnerState();
          const ownershipError = getLinkedinRunnerActionOwnershipError({
            runnerState,
            tabId,
            actionId: id,
            claimedAt,
          });

          if (ownershipError) {
            return { success: false, error: ownershipError };
          }

          const claimedBy = runnerState.activeAction?.claimedBy;

          if (!claimedBy || !claimedAt) {
            return {
              success: false,
              error: 'The active action did not include a complete claim',
            };
          }

          const client = await getApiClient();
          const providerStartRequestedAt = Date.now();
          const startedAction = await startActionClaim(
            client,
            id,
            claimedBy,
            claimedAt,
          );

          if (!startedAction) {
            const reconciliation = await releaseRunnerActionBeforeProviderStart(
              {
                runnerState,
                releaseAction: async (action) => {
                  if (!action.claimedAt || !action.claimedBy) {
                    throw new Error(
                      'The rejected action did not include a complete claim',
                    );
                  }

                  return releaseActionClaim(
                    await getApiClient(),
                    action.id,
                    action.claimedBy,
                    action.claimedAt,
                  );
                },
                fetchAction: async (actionId) =>
                  fetchLinkedinActionById(await getApiClient(), actionId),
              },
            );

            await setLinkedinRunnerState(reconciliation.runnerState);

            return {
              success: false,
              error:
                reconciliation.error ??
                'The server no longer accepts this LinkedIn action lease. The provider was not started.',
            };
          }

          const startResolution = resolveRunnerProviderStart({
            runnerState,
            serverAction: startedAction,
            requestStartedAt: providerStartRequestedAt,
          });
          const nextState = startResolution.runnerState;

          await setLinkedinRunnerState(nextState);

          if (startResolution.error) {
            return { success: false, error: startResolution.error };
          }

          return { success: true, data: nextState };
        });
      }

      case 'ABORT_LINKEDIN_ACTION_BEFORE_PROVIDER_START': {
        const { id, claimedAt } = message.payload as {
          id: string;
          claimedAt: string | null;
        };
        const tabId = sender?.tab?.id;

        return await withLinkedinRunnerStateOperation(async () => {
          const runnerState = await getLinkedinRunnerState();
          const ownershipError = getLinkedinRunnerActionOwnershipError({
            runnerState,
            tabId,
            actionId: id,
            claimedAt,
            requireEnabled: false,
          });

          if (ownershipError) {
            return { success: false, error: ownershipError };
          }

          const reconciliation = await releaseRunnerActionBeforeProviderStart({
            runnerState,
            releaseAction: async (action) => {
              if (!action.claimedAt || !action.claimedBy) {
                throw new Error(
                  'The paused action did not include a complete claim',
                );
              }

              return releaseActionClaim(
                await getApiClient(),
                action.id,
                action.claimedBy,
                action.claimedAt,
              );
            },
            fetchAction: async (actionId) =>
              fetchLinkedinActionById(await getApiClient(), actionId),
          });

          await setLinkedinRunnerState(reconciliation.runnerState);

          if (reconciliation.error) {
            return { success: false, error: reconciliation.error };
          }

          return { success: true, data: reconciliation.runnerState };
        });
      }

      case 'GET_LINKEDIN_SYNC_TOTALS': {
        const requestedOwnerLinkedinId = (
          message.payload as { ownerLinkedinId?: string } | undefined
        )?.ownerLinkedinId;
        const ownerLinkedinId =
          requestedOwnerLinkedinId ??
          (await getStoredLinkedInIdentity())?.linkedinId;

        if (!ownerLinkedinId) {
          return {
            success: true,
            data: {
              connections: 0,
              invitations: 0,
              threads: 0,
              messages: 0,
            },
          };
        }

        const client = await getApiClient();
        const totals = await getLinkedInSyncTotalsWithClient(
          client,
          ownerLinkedinId,
        );

        return { success: true, data: totals };
      }

      case 'GET_LINKEDIN_SAFETY_SNAPSHOT':
        return { success: true, data: await getLinkedInSafetySnapshot() };

      case 'RECORD_LINKEDIN_OUTBOUND_ATTEMPT': {
        const { actionId, attemptedAt } = message.payload as {
          actionId: string;
          attemptedAt: number;
        };
        await recordLinkedInOutboundAttempt(actionId, attemptedAt);
        return { success: true };
      }

      case 'TRIP_LINKEDIN_SAFETY_CIRCUIT': {
        const { reason } = message.payload as { reason: string };
        await tripLinkedInSafetyCircuit(reason);
        return { success: true };
      }

      case 'GET_LINKEDIN_SAFETY_SETTINGS':
        return { success: true, data: await getLinkedInSafetySettings() };

      case 'SET_LINKEDIN_SAFETY_SETTINGS':
        return {
          success: true,
          data: await setLinkedInSafetySettings(
            message.payload as {
              dailyReadLimitEnabled?: boolean;
              dailyReadLimit?: number;
            },
          ),
        };

      case 'REQUEST_LINKEDIN_SYNC':
        void linkedInSync.run(true);
        return { success: true };

      case 'GET_LINKEDIN_SYNC_STATUS': {
        const identity = await getStoredLinkedInIdentity();
        const state = identity
          ? await getLinkedInSyncState(identity.linkedinId)
          : null;
        return {
          success: true,
          data: {
            ...(await linkedInSync.getStatus()),
            lastRunAt: state?.lastRunAt ?? null,
          },
        };
      }

      case 'GET_LINKEDIN_RUNNER_STATE': {
        const runnerState = await getLinkedinRunnerState();
        const tabId = sender?.tab?.id;

        return {
          success: true,
          data:
            typeof tabId === 'number' && runnerState.tabId === tabId
              ? runnerState
              : { ...DEFAULT_LINKEDIN_RUNNER_STATE },
        };
      }

      case 'SET_LINKEDIN_RUNNER_STATE': {
        const { enabled } = message.payload as { enabled: boolean };
        const tabId = sender?.tab?.id;

        return await withLinkedinRunnerStateOperation(async () => {
          let runnerState = await getLinkedinRunnerState();

          if (
            !enabled &&
            runnerState.enabled &&
            (typeof tabId !== 'number' || runnerState.tabId !== tabId)
          ) {
            return {
              success: false,
              error: 'This tab is not the active LinkedIn runner.',
            };
          }

          if (enabled) {
            const ownershipError = getLinkedinRunnerEnableError(
              runnerState,
              tabId,
              true,
            );

            if (ownershipError) {
              return { success: false, error: ownershipError };
            }

            if (runnerState.activeActionNeedsReconciliation) {
              const reconciliation = await reconcileRunnerActionOnEnable({
                runnerState,
                fetchAction: async (id) =>
                  fetchLinkedinActionById(await getApiClient(), id),
                recordRecoveryAttempt: recordLinkedInOutboundAttempt,
              });

              if (reconciliation.error) {
                return {
                  success: false,
                  error: reconciliation.error,
                };
              }

              runnerState = reconciliation.runnerState;
            }

            const enableError = getLinkedinRunnerEnableError(
              runnerState,
              tabId,
            );

            if (enableError) {
              return { success: false, error: enableError };
            }
          }

          if (
            enabled &&
            runnerState.activeActionNeedsRelease &&
            runnerState.activeAction
          ) {
            const { claimedAt, claimedBy, id } = runnerState.activeAction;

            if (!claimedAt || !claimedBy) {
              return {
                success: false,
                error: 'The unstarted action did not include a complete claim',
              };
            }

            try {
              const client = await getApiClient();

              // A previous tab could not confirm this safe release. Resolve it
              // before attaching the action to a replacement tab; never run an
              // action whose server lease may already have moved elsewhere.
              const releasedAction = await releaseActionClaim(
                client,
                id,
                claimedBy,
                claimedAt,
              );

              if (releasedAction === null) {
                const reconciliation = await reconcileRunnerReleaseOnEnable({
                  runnerState,
                  fetchAction: async (id) =>
                    fetchLinkedinActionById(await getApiClient(), id),
                });

                if (reconciliation.error) {
                  return {
                    success: false,
                    error: reconciliation.error,
                  };
                }

                runnerState = reconciliation.runnerState;
              } else {
                runnerState = {
                  ...runnerState,
                  activeAction: null,
                  activeActionStartedAt: null,
                  activeActionNeedsRelease: false,
                  activeActionNeedsReconciliation: false,
                };
              }
            } catch (error) {
              return {
                success: false,
                error: `Could not release the interrupted unstarted action: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              };
            }
          }

          if (
            !enabled &&
            runnerState.activeAction &&
            runnerState.activeActionStartedAt === null &&
            !runnerState.activeActionNeedsReconciliation
          ) {
            const { claimedAt, claimedBy, id } = runnerState.activeAction;
            let didReleaseAction = false;

            if (claimedAt && claimedBy) {
              try {
                const client = await getApiClient();
                const releasedAction = await releaseActionClaim(
                  client,
                  id,
                  claimedBy,
                  claimedAt,
                );

                didReleaseAction = releasedAction !== null;
              } catch (error) {
                console.error(
                  '[Twenty] Could not release the action while pausing the runner:',
                  error,
                );
              }
            }

            runnerState = getRunnerStateAfterPause({
              runnerState,
              didReleaseUnstartedAction: didReleaseAction,
            });
          } else if (!enabled) {
            runnerState = getRunnerStateAfterPause({ runnerState });
          }

          const nextState =
            enabled && typeof tabId === 'number'
              ? getRunnerStateAfterEnable({ runnerState, tabId })
              : runnerState;

          await setLinkedinRunnerState(nextState);

          if (!enabled) {
            await browser.action.setBadgeText({ text: '' });
          }

          return { success: true, data: nextState };
        });
      }

      case 'UPDATE_RECORD': {
        const { id, type, data } = message.payload as {
          id: string;
          type: 'person' | 'company';
          data: LinkedInProfileData | LinkedInCompanyData;
        };
        const client = await getApiClient();
        await client.updateRecordWithLinkedInData(id, type, data);
        return { success: true, data: { id } };
      }

      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('Background error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Message handler
export default defineBackground(() => {
  // Use the proper WXT/webextension-polyfill pattern for async message handling
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, sender, sendResponse) => {
      // Handle async by returning true and using sendResponse
      void handleMessage(message, sender).then(sendResponse);
      return true; // Indicates we will send a response asynchronously
    },
  );

  void Promise.all([
    ensurePeriodicAlarm(LINKEDIN_RUNNER_ALARM, 1),
    ensurePeriodicAlarm(LINKEDIN_SYNC_ALARM, LINKEDIN_SYNC_INTERVAL_MINUTES),
  ]);
  browser.runtime.onStartup.addListener(() => void linkedInSync.run());
  browser.runtime.onInstalled.addListener(() => void linkedInSync.run());
  browser.tabs.onRemoved.addListener((tabId) => {
    void handleLinkedinRunnerTabRemoved(tabId).catch((error) =>
      console.error('[Twenty] Runner tab cleanup failed:', error),
    );
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LINKEDIN_SYNC_ALARM) {
      void linkedInSync.run();
      return;
    }

    if (alarm.name !== LINKEDIN_RUNNER_ALARM) {
      return;
    }

    void (async () => {
      const runnerState = await getLinkedinRunnerState();

      if (!runnerState.enabled) {
        await browser.action.setBadgeText({ text: '' });
        return;
      }

      try {
        const client = await getApiClient();
        const dueActions = await fetchDueActions(client);

        await browser.action.setBadgeBackgroundColor({ color: '#6366f1' });
        await browser.action.setBadgeText({
          text: dueActions.length > 0 ? String(dueActions.length) : '',
        });

        if (typeof runnerState.tabId === 'number') {
          await browser.tabs
            .sendMessage(runnerState.tabId, { type: 'RUN_LINKEDIN_POLL' })
            .catch(() => undefined);
        }
      } catch (error) {
        console.error('[Twenty] LinkedIn runner alarm failed:', error);
        await browser.action.setBadgeBackgroundColor({ color: '#ef4444' });
        await browser.action.setBadgeText({ text: '!' });
      }
    })();
  });

  console.log('Twenty CRM Extension background loaded');
});
