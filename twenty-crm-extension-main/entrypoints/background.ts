import { TwentyApiClient, extractTokenFromCookie } from '../utils/twenty-api';
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
  saveTwentyTokenPair,
} from '../utils/storage';
import {
  getLinkedInSyncTotalsWithClient,
  handleLinkedInHarvestStoreRequest,
  type LinkedInHarvestStoreRequest,
} from '../utils/linkedin-harvest-store';
import {
  getLinkedInSafetySettings,
  getLinkedInSafetySnapshot,
  recordLinkedInOutboundAttempt,
  setLinkedInSafetySettings,
} from '../utils/linkedin-safety';
import { getStoredLinkedInIdentity } from '../utils/linkedin-sync-state';
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
  LinkedInSyncLock,
  LinkedInSyncProgress,
  TwentyLinkedInAction,
} from '../types';

const LINKEDIN_RUNNER_ALARM = 'twenty-linkedin-runner-poll';
const LINKEDIN_SYNC_ALARM = 'twenty-linkedin-automatic-sync';
const LINKEDIN_RUNNER_STATE_KEY = 'twentyLinkedinRunnerState';
const LINKEDIN_SYNC_LOCKS_KEY = 'twentyLinkedinSyncLocks';
const LINKEDIN_SYNC_LOCK_TTL_MILLISECONDS = 30_000;

let linkedinSyncLockOperation: Promise<void> = Promise.resolve();
const withLinkedinRunnerStateOperation =
  createSerializedLinkedinRunnerOperation();

const withLinkedinSyncLockStore = <TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const result = linkedinSyncLockOperation.then(operation, operation);

  linkedinSyncLockOperation = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
};

const getStoredLinkedinSyncLocks = async (): Promise<
  Record<string, LinkedInSyncLock>
> => {
  const storedValue = await browser.storage.session.get(
    LINKEDIN_SYNC_LOCKS_KEY,
  );

  return (
    (storedValue[LINKEDIN_SYNC_LOCKS_KEY] as
      | Record<string, LinkedInSyncLock>
      | undefined) ?? {}
  );
};

const saveStoredLinkedinSyncLocks = async (
  locks: Record<string, LinkedInSyncLock>,
): Promise<void> => {
  await browser.storage.session.set({ [LINKEDIN_SYNC_LOCKS_KEY]: locks });
};

const getLiveLinkedinSyncLockFromStore = (
  locks: Record<string, LinkedInSyncLock>,
  key: string,
): LinkedInSyncLock | null => {
  const lock = locks[key];

  if (!lock) {
    return null;
  }

  if (lock.expiresAt <= Date.now()) {
    delete locks[key];
    return null;
  }

  return lock;
};

const isTabAlive = async (tabId: number): Promise<boolean> => {
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
};

const acquireLinkedinSyncLock = async (
  key: string,
  ownerTabId: number,
  progress: LinkedInSyncProgress,
): Promise<{ acquired: boolean; lock: LinkedInSyncLock }> => {
  return withLinkedinSyncLockStore(async () => {
    const locks = await getStoredLinkedinSyncLocks();
    const existingLock = getLiveLinkedinSyncLockFromStore(locks, key);

    if (
      existingLock &&
      existingLock.ownerTabId !== ownerTabId &&
      (await isTabAlive(existingLock.ownerTabId))
    ) {
      await saveStoredLinkedinSyncLocks(locks);
      return { acquired: false, lock: existingLock };
    }

    const lock: LinkedInSyncLock = {
      key,
      ownerTabId,
      expiresAt: Date.now() + LINKEDIN_SYNC_LOCK_TTL_MILLISECONDS,
      progress,
    };

    locks[key] = lock;
    await saveStoredLinkedinSyncLocks(locks);

    return { acquired: true, lock };
  });
};

const heartbeatLinkedinSyncLock = async (
  key: string,
  ownerTabId: number,
  progress: LinkedInSyncProgress,
): Promise<LinkedInSyncLock | null> =>
  withLinkedinSyncLockStore(async () => {
    const locks = await getStoredLinkedinSyncLocks();
    const lock = getLiveLinkedinSyncLockFromStore(locks, key);

    if (!lock || lock.ownerTabId !== ownerTabId) {
      await saveStoredLinkedinSyncLocks(locks);
      return null;
    }

    const nextLock = {
      ...lock,
      expiresAt: Date.now() + LINKEDIN_SYNC_LOCK_TTL_MILLISECONDS,
      progress,
    };

    locks[key] = nextLock;
    await saveStoredLinkedinSyncLocks(locks);

    return nextLock;
  });

const releaseLinkedinSyncLock = async (
  key: string,
  ownerTabId: number,
): Promise<boolean> =>
  withLinkedinSyncLockStore(async () => {
    const locks = await getStoredLinkedinSyncLocks();
    const lock = getLiveLinkedinSyncLockFromStore(locks, key);

    if (!lock || lock.ownerTabId !== ownerTabId) {
      await saveStoredLinkedinSyncLocks(locks);
      return false;
    }

    delete locks[key];
    await saveStoredLinkedinSyncLocks(locks);
    return true;
  });

const getLiveLinkedinSyncLock = async (
  key: string,
): Promise<LinkedInSyncLock | null> =>
  withLinkedinSyncLockStore(async () => {
    const locks = await getStoredLinkedinSyncLocks();
    const lock = getLiveLinkedinSyncLockFromStore(locks, key);

    await saveStoredLinkedinSyncLocks(locks);
    return lock;
  });

const removeLinkedinSyncLocksForTab = async (tabId: number): Promise<void> =>
  withLinkedinSyncLockStore(async () => {
    const locks = await getStoredLinkedinSyncLocks();

    for (const [key, lock] of Object.entries(locks)) {
      if (lock.ownerTabId === tabId) {
        delete locks[key];
      }
    }

    await saveStoredLinkedinSyncLocks(locks);
  });

const requestLinkedinSyncInExistingTab = async (
  force: boolean,
): Promise<boolean> => {
  const tabs = await browser.tabs.query({
    url: ['*://linkedin.com/*', '*://*.linkedin.com/*'],
  });
  const targetTab =
    tabs.find((tab) => tab.active && !tab.discarded && tab.id !== undefined) ??
    tabs.find((tab) => !tab.discarded && tab.id !== undefined);

  if (targetTab?.id === undefined) {
    return false;
  }

  await browser.tabs.sendMessage(targetTab.id, {
    type: 'RUN_LINKEDIN_SYNC',
    force,
  });

  return true;
};

const ensurePeriodicAlarm = async (
  name: string,
  periodInMinutes: number,
): Promise<void> => {
  if (!(await browser.alarms.get(name))) {
    await browser.alarms.create(name, { periodInMinutes });
  }
};

const getLinkedinCsrfToken = async (): Promise<string> => {
  const cookies = await browser.cookies.getAll({
    domain: 'www.linkedin.com',
    name: 'JSESSIONID',
  });
  const csrfToken = cookies[0]?.value.replace(/^"|"$/g, '');

  if (!csrfToken) {
    throw new Error(
      'LinkedIn session cookie was not found. Sign in to LinkedIn first.',
    );
  }

  return csrfToken;
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
  await removeLinkedinSyncLocksForTab(tabId);
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
let apiClient: TwentyApiClient | null = null;
let cachedTwentyApiUrl: string | null = null;

type RenewTokenResult = {
  renewToken?: {
    tokens?: TwentyTokenPair;
  };
};

const RENEW_TOKEN_MUTATION = `
  mutation RenewToken($appToken: String!) {
    renewToken(appToken: $appToken) {
      tokens {
        accessOrWorkspaceAgnosticToken {
          token
          expiresAt
        }
        refreshToken {
          token
          expiresAt
        }
      }
    }
  }
`;

// Get or create API client
async function getApiClient(): Promise<TwentyApiClient> {
  const settings = await getSettings();

  if (!settings.twentyApiUrl) {
    throw new Error('Twenty API URL not configured');
  }

  // Create new client if URL changed
  if (cachedTwentyApiUrl !== settings.twentyApiUrl || !apiClient) {
    apiClient = new TwentyApiClient(settings.twentyApiUrl);
    cachedTwentyApiUrl = settings.twentyApiUrl;
  }

  const token = await getAuthToken(settings);
  if (!token) {
    throw new Error(
      'No authentication token found. Please log in to local Twenty CRM.',
    );
  }

  apiClient.setToken(token);
  return apiClient;
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

async function getTokenFromStorage(): Promise<string | null> {
  const tokenPair = await getTwentyTokenPair();

  if (!isValidTwentyTokenPair(tokenPair)) {
    return null;
  }

  return tokenPair.accessOrWorkspaceAgnosticToken.token;
}

function isTokenExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtTime = new Date(expiresAt).getTime();

  if (Number.isNaN(expiresAtTime)) {
    return false;
  }

  return expiresAtTime <= Date.now() + 30_000;
}

async function renewTokenPair(
  settings: ExtensionSettings,
): Promise<string | null> {
  const tokenPair = await getTwentyTokenPair();

  if (!isValidTwentyTokenPair(tokenPair)) {
    return null;
  }

  if (!isTokenExpired(tokenPair.accessOrWorkspaceAgnosticToken.expiresAt)) {
    return tokenPair.accessOrWorkspaceAgnosticToken.token;
  }

  try {
    const response = await fetch(`${settings.twentyApiUrl}/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: RENEW_TOKEN_MUTATION,
        variables: {
          appToken: tokenPair.refreshToken.token,
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();

      console.error(
        '[Twenty] Token renewal HTTP error:',
        response.status,
        responseText,
      );
      return tokenPair.accessOrWorkspaceAgnosticToken.token;
    }

    const result = (await response.json()) as {
      data?: RenewTokenResult;
      errors?: Array<{ message: string }>;
    };

    if (result.errors?.length) {
      console.error(
        '[Twenty] Token renewal GraphQL error:',
        result.errors.map((error) => error.message).join('; '),
      );
      return tokenPair.accessOrWorkspaceAgnosticToken.token;
    }

    const renewedTokenPair = result.data?.renewToken?.tokens;

    if (!isValidTwentyTokenPair(renewedTokenPair)) {
      console.error('[Twenty] Token renewal did not return a valid token pair');
      return tokenPair.accessOrWorkspaceAgnosticToken.token;
    }

    await saveTwentyTokenPair(renewedTokenPair);
    console.log('[Twenty] Local token renewed');

    return renewedTokenPair.accessOrWorkspaceAgnosticToken.token;
  } catch (error) {
    console.error('[Twenty] Token renewal failed:', error);
    return tokenPair.accessOrWorkspaceAgnosticToken.token;
  }
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
    const injectionResults = await browser.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => localStorage.getItem('tokenPairState'),
    });
    const rawTokenPair = injectionResults[0]?.result ?? null;
    const tokenPair = parseTokenPair(rawTokenPair);

    await saveTwentyTokenPair(tokenPair);

    console.log(
      'Active tab Twenty token sync:',
      tokenPair ? 'synced' : 'no token found',
    );

    return isValidTwentyTokenPair(tokenPair);
  } catch (error) {
    console.error('Failed to sync token from active Twenty tab:', error);
    return false;
  }
}

// Get auth token from synced local storage first, then legacy Twenty cookie.
async function getAuthToken(
  settings: ExtensionSettings,
): Promise<string | null> {
  const storedToken =
    (await renewTokenPair(settings)) ?? (await getTokenFromStorage());

  if (storedToken) {
    return storedToken;
  }

  try {
    const cookieUrl = settings.twentyAppUrl || settings.twentyApiUrl;
    // Try to get the tokenPair cookie from Twenty domain
    const cookie = await browser.cookies.get({
      url: cookieUrl,
      name: 'tokenPair',
    });

    console.log(
      'Cookie lookup for',
      cookieUrl,
      ':',
      cookie ? 'found' : 'not found',
    );

    if (cookie?.value) {
      const decodedValue = decodeURIComponent(cookie.value);
      return extractTokenFromCookie(decodedValue);
    }

    // Also try without www
    const altUrl = cookieUrl.includes('://www.')
      ? cookieUrl.replace('://www.', '://')
      : cookieUrl.replace('://', '://www.');

    const altCookie = await browser.cookies.get({
      url: altUrl,
      name: 'tokenPair',
    });

    console.log(
      'Alt cookie lookup for',
      altUrl,
      ':',
      altCookie ? 'found' : 'not found',
    );

    if (altCookie?.value) {
      const decodedValue = decodeURIComponent(altCookie.value);
      return extractTokenFromCookie(decodedValue);
    }

    return null;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

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
  sender?: { tab?: { id?: number } },
): Promise<ExtensionResponse> {
  console.log('Received message:', message.type);

  try {
    switch (message.type) {
      case 'SYNC_TWENTY_TOKEN_PAIR': {
        const tokenPair = message.payload as TwentyTokenPair | null;
        const hasValidTokenPair = isValidTwentyTokenPair(tokenPair);

        console.log(
          'Twenty token sync payload:',
          hasValidTokenPair ? 'valid token pair' : 'no valid token pair',
        );

        await saveTwentyTokenPair(hasValidTokenPair ? tokenPair : null);

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
          ? !!(await getAuthToken(settings))
          : false;
        return {
          success: true,
          data: { ...settings, hasToken },
        };
      }

      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as Partial<ExtensionSettings>;
        console.log('Saving settings:', newSettings);
        await saveSettings(newSettings);
        // Clear cached client when URL changes
        if (newSettings.twentyApiUrl) {
          apiClient = null;
          cachedTwentyApiUrl = null;
        }
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

      case 'GET_LINKEDIN_CSRF_TOKEN': {
        const csrfToken = await getLinkedinCsrfToken();

        return { success: true, data: { csrfToken } };
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

      case 'REQUEST_LINKEDIN_SYNC': {
        const safetySnapshot = await getLinkedInSafetySnapshot();

        if (
          safetySnapshot.cooldownUntil !== null &&
          safetySnapshot.cooldownUntil > Date.now()
        ) {
          return {
            success: false,
            error: `${safetySnapshot.cooldownReason ?? 'LinkedIn safety cooldown is active.'} Sync is paused until ${new Date(safetySnapshot.cooldownUntil).toLocaleString()}.`,
          };
        }

        const dispatched = await requestLinkedinSyncInExistingTab(true);

        return {
          success: dispatched,
          data: { dispatched },
          error: dispatched
            ? undefined
            : 'Open LinkedIn in a tab before starting a sync.',
        };
      }

      case 'LINKEDIN_HARVEST_STORE': {
        const client = await getApiClient();
        const result = await handleLinkedInHarvestStoreRequest(
          client,
          message.payload as LinkedInHarvestStoreRequest,
        );

        return { success: true, data: result };
      }

      case 'SYNC_LOCK_ACQUIRE': {
        const tabId = sender?.tab?.id;
        const { key, progress } = message.payload as {
          key: string;
          progress: LinkedInSyncProgress;
        };

        if (typeof tabId !== 'number') {
          return {
            success: false,
            error: 'The LinkedIn sync tab could not be identified',
          };
        }

        return {
          success: true,
          data: await acquireLinkedinSyncLock(key, tabId, progress),
        };
      }

      case 'SYNC_LOCK_HEARTBEAT': {
        const tabId = sender?.tab?.id;
        const { key, progress } = message.payload as {
          key: string;
          progress: LinkedInSyncProgress;
        };

        if (typeof tabId !== 'number') {
          return {
            success: false,
            error: 'The LinkedIn sync tab could not be identified',
          };
        }

        const lock = await heartbeatLinkedinSyncLock(key, tabId, progress);

        return {
          success: lock !== null,
          data: { lock },
          error: lock ? undefined : 'This tab no longer owns the sync lock',
        };
      }

      case 'SYNC_LOCK_RELEASE': {
        const tabId = sender?.tab?.id;
        const { key } = message.payload as { key: string };

        return {
          success:
            typeof tabId === 'number' &&
            (await releaseLinkedinSyncLock(key, tabId)),
        };
      }

      case 'SYNC_LOCK_STATUS': {
        const { key } = message.payload as { key: string };

        return {
          success: true,
          data: { lock: await getLiveLinkedinSyncLock(key) },
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
    ensurePeriodicAlarm(LINKEDIN_SYNC_ALARM, 30),
  ]);
  browser.tabs.onRemoved.addListener((tabId) => {
    void handleLinkedinRunnerTabRemoved(tabId).catch((error) =>
      console.error('[Twenty] Runner tab cleanup failed:', error),
    );
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LINKEDIN_SYNC_ALARM) {
      void requestLinkedinSyncInExistingTab(false).catch((error) =>
        console.error(
          '[Twenty] Automatic LinkedIn sync dispatch failed:',
          error,
        ),
      );
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
