import { TwentyApiClient, extractTokenFromCookie } from '../utils/twenty-api';
import {
  claimAction,
  fetchDueActions,
  fetchLinkedinActionQueue,
  reportAction,
} from '../utils/linkedin-actions-api';
import {
  getSettings,
  saveSettings,
  addToRecentCaptures,
  getRecentCaptures,
  getTwentyTokenPair,
  saveTwentyTokenPair,
} from '../utils/storage';
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
} from '../types';

const LINKEDIN_RUNNER_ALARM = 'twenty-linkedin-runner-poll';
const LINKEDIN_RUNNER_STATE_KEY = 'twentyLinkedinRunnerState';

const DEFAULT_LINKEDIN_RUNNER_STATE: LinkedInRunnerSessionState = {
  enabled: false,
  tabId: null,
  activeAction: null,
  activeActionStartedAt: null,
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

        if (typeof tabId !== 'number') {
          return {
            success: false,
            error: 'The runner tab could not be identified',
          };
        }

        const client = await getApiClient();
        const action = await claimAction(client, id, `extension-tab-${tabId}`);

        if (!action) {
          return { success: true, data: null };
        }

        const runnerState = await getLinkedinRunnerState();

        await setLinkedinRunnerState({
          ...runnerState,
          enabled: true,
          tabId,
          activeAction: action,
          activeActionStartedAt: null,
        });

        return { success: true, data: action };
      }

      case 'REPORT_LINKEDIN_ACTION': {
        const { id, status, connectionState, errorMessage } =
          message.payload as {
            id: string;
            status: Extract<
              LinkedInActionStatus,
              'COMPLETED' | 'SKIPPED' | 'FAILED'
            >;
            connectionState: LinkedInConnectionState;
            errorMessage?: string | null;
          };
        const client = await getApiClient();
        const action = await reportAction(client, id, {
          status,
          connectionState,
          errorMessage,
        });
        const runnerState = await getLinkedinRunnerState();

        await setLinkedinRunnerState({
          ...runnerState,
          activeAction: null,
          activeActionStartedAt: null,
          lastExecutedAt: Date.now(),
          completedCount:
            runnerState.completedCount + (status === 'FAILED' ? 0 : 1),
          failedCount: runnerState.failedCount + (status === 'FAILED' ? 1 : 0),
        });

        return { success: true, data: action };
      }

      case 'MARK_LINKEDIN_ACTION_EXECUTING': {
        const { id } = message.payload as { id: string };
        const runnerState = await getLinkedinRunnerState();

        if (runnerState.activeAction?.id !== id) {
          return {
            success: false,
            error: 'The action is no longer claimed by this runner',
          };
        }

        const nextState = {
          ...runnerState,
          activeActionStartedAt: Date.now(),
        };

        await setLinkedinRunnerState(nextState);

        return { success: true, data: nextState };
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

        if (enabled && typeof tabId !== 'number') {
          return {
            success: false,
            error: 'The runner tab could not be identified',
          };
        }

        const runnerState = await getLinkedinRunnerState();
        const nextState = {
          ...runnerState,
          enabled,
          tabId: enabled ? (tabId ?? null) : null,
        };

        await setLinkedinRunnerState(nextState);

        if (!enabled) {
          await browser.action.setBadgeText({ text: '' });
        }

        return { success: true, data: nextState };
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
      handleMessage(message, sender).then(sendResponse);
      return true; // Indicates we will send a response asynchronously
    },
  );

  browser.alarms.create(LINKEDIN_RUNNER_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
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
