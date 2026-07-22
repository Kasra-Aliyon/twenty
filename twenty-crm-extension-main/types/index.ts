// LinkedIn Data Types
export type LinkedInProfileData = {
  type: 'person';
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline?: string;
  jobTitle?: string;
  currentCompany?: string;
  currentCompanyLinkedInUrl?: string;
  profileImageUrl?: string;
  location?: string;
};

export type LinkedInCompanyData = {
  type: 'company';
  linkedinUrl: string;
  name: string;
  website?: string;
  industry?: string;
  employeeCount?: string;
  logoUrl?: string;
  description?: string;
};

export type LinkedInData = LinkedInProfileData | LinkedInCompanyData;

// Twenty CRM Types
// Links composite type: primaryLinkUrl, primaryLinkLabel, secondaryLinks
export type TwentyLinks = {
  primaryLinkUrl?: string;
  primaryLinkLabel?: string;
  secondaryLinks?: Array<{ url: string; label: string }> | null;
};

export type TwentyPerson = {
  id: string;
  name: {
    firstName: string;
    lastName: string;
  };
  linkedinLink?: TwentyLinks;
  jobTitle?: string;
  avatarUrl?: string;
  company?: {
    id: string;
    name: string;
  };
};

export type TwentyCompany = {
  id: string;
  name: string;
  linkedinLink?: TwentyLinks;
  domainName?: TwentyLinks;
  employees?: number;
  idealCustomerProfile?: boolean;
};

export type TwentyRecordList = {
  id: string;
  name: string;
  type: 'PERSON' | 'COMPANY';
  folder: {
    id: string;
    name: string;
  } | null;
};

export type LinkedInActionType =
  | 'SEND_CONNECTION_REQUEST'
  | 'SEND_MESSAGE'
  | 'WITHDRAW_CONNECTION_REQUEST';

export type LinkedInActionStatus =
  | 'SCHEDULED'
  | 'CLAIMED'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED'
  | 'CANCELLED';

export type LinkedInConnectionState =
  | 'UNKNOWN'
  | 'NOT_CONNECTED'
  | 'PENDING'
  | 'CONNECTED'
  | 'WITHDRAWN';

export type TwentyLinkedInAction = {
  id: string;
  type: LinkedInActionType;
  status: LinkedInActionStatus;
  scheduledAt: string;
  claimedAt: string | null;
  linkedinUrl: string;
  noteText: string;
  connectionState: LinkedInConnectionState;
  attemptCount: number;
  errorMessage: string | null;
  sequenceStepId: string | null;
  skipIfAlreadyConnected: boolean;
};

export type LinkedInRunnerSessionState = {
  enabled: boolean;
  tabId: number | null;
  activeAction: TwentyLinkedInAction | null;
  activeActionStartedAt: number | null;
  lastExecutedAt: number | null;
  completedCount: number;
  failedCount: number;
};

export type LinkedInInvitationDirection = 'SENT' | 'RECEIVED';

export type LinkedInMessageDirection = 'INBOUND' | 'OUTBOUND';

export type LinkedInIdentity = {
  linkedinId: string;
  linkedinUrn: string;
  handle: string | null;
  name: string;
};

export type LinkedInHarvestConnection = {
  profileUrn: string;
  linkedinUrn: string;
  linkedinId: string | null;
  handle: string;
  name: string;
  headline: string | null;
  profileUrl: string;
  connectedAt: string | null;
};

export type LinkedInHarvestInvitation = {
  profileUrn: string;
  linkedinId: string | null;
  direction: LinkedInInvitationDirection;
  handle: string;
  name: string;
  headline: string | null;
  message: string | null;
  sentAt: string | null;
};

export type LinkedInHarvestParticipant = {
  linkedinId: string | null;
  linkedinUrn: string | null;
  name: string;
  headline: string | null;
  handle: string | null;
  profileUrl: string | null;
  isSelf: boolean;
};

export type LinkedInHarvestThreadParticipant = LinkedInHarvestParticipant & {
  sourceThreadId: string;
  threadId: string;
};

export type LinkedInHarvestThread = {
  threadId: string;
  name: string;
  firstMessageTime: string;
  lastMessageTime: string;
  participants: LinkedInHarvestParticipant[];
  labels: string[];
};

export type LinkedInHarvestMessage = {
  messageId: string;
  threadId: string;
  body: string;
  deliveredAt: string;
  direction: LinkedInMessageDirection;
  senderName: string;
  senderLinkedinUrn: string | null;
};

export type LinkedInSyncProgress = {
  connections: number;
  invitations: number;
  threads: number;
  messages: number;
};

export type LinkedInSyncTotals = LinkedInSyncProgress;

export type LinkedInSyncState = {
  safeSyncedThroughLastActivityAt: number | null;
  historicalBackfillComplete: boolean;
  connectionBackfillComplete: boolean;
  connectionBackfillStart: number;
  connectionSyncRevision: number;
  invitationSyncRevision: number;
  messageSyncRevision: number;
  lastConnectionSyncAt: number | null;
  lastMessageSyncAt: number | null;
  lastAttemptAt: number | null;
  lastRunAt: number | null;
  syncStartedAt: number | null;
  lastError: string | null;
};

export type LinkedInSafetyState = {
  readRequestTimestamps: number[];
  outboundAttempts: Array<{ actionId: string; attemptedAt: number }>;
  cooldownUntil: number | null;
  cooldownReason: string | null;
};

export type LinkedInSafetySnapshot = {
  readRequestsLastHour: number;
  readRequestsToday: number;
  outboundAttemptsToday: number;
  outboundDailyLimit: number;
  nextOutboundAt: number | null;
  cooldownUntil: number | null;
  cooldownReason: string | null;
};

export type LinkedInSafetySettings = {
  dailyOutboundLimit: number;
};

export type LinkedInSyncLock = {
  key: string;
  ownerTabId: number;
  expiresAt: number;
  progress: LinkedInSyncProgress;
};

export type TwentyTokenPair = {
  accessOrWorkspaceAgnosticToken: {
    token: string;
    expiresAt: string;
  };
  refreshToken: {
    token: string;
    expiresAt: string;
  };
};

// Extension State Types
export type CaptureStatus =
  | 'idle'
  | 'loading'
  | 'exists'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'error';

export type CaptureState = {
  status: CaptureStatus;
  showListPanel: boolean;
  existingRecord?: {
    id: string;
    type: 'person' | 'company';
  };
  error?: string;
  data?: LinkedInData;
};

// Message Types for Extension Communication
export type MessageType =
  | 'SYNC_TWENTY_TOKEN_PAIR'
  | 'SYNC_TWENTY_TOKEN_PAIR_FROM_ACTIVE_TAB'
  | 'GET_AUTH_TOKEN'
  | 'CHECK_DUPLICATE'
  | 'CREATE_RECORD'
  | 'UPDATE_RECORD'
  | 'SEARCH_RECORDS'
  | 'GET_RECORD_LISTS'
  | 'ADD_TO_RECORD_LISTS'
  | 'CREATE_RECORD_LIST'
  | 'FETCH_DUE_LINKEDIN_ACTIONS'
  | 'FETCH_LINKEDIN_ACTION_QUEUE'
  | 'CLAIM_LINKEDIN_ACTION'
  | 'REPORT_LINKEDIN_ACTION'
  | 'MARK_LINKEDIN_ACTION_EXECUTING'
  | 'GET_LINKEDIN_RUNNER_STATE'
  | 'SET_LINKEDIN_RUNNER_STATE'
  | 'RUN_LINKEDIN_POLL'
  | 'REQUEST_LINKEDIN_SYNC'
  | 'GET_LINKEDIN_CSRF_TOKEN'
  | 'GET_LINKEDIN_SYNC_TOTALS'
  | 'GET_LINKEDIN_SAFETY_SNAPSHOT'
  | 'GET_LINKEDIN_SAFETY_SETTINGS'
  | 'SET_LINKEDIN_SAFETY_SETTINGS'
  | 'LINKEDIN_HARVEST_STORE'
  | 'SYNC_LOCK_ACQUIRE'
  | 'SYNC_LOCK_HEARTBEAT'
  | 'SYNC_LOCK_RELEASE'
  | 'SYNC_LOCK_STATUS'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'TEST_CONNECTION'
  | 'GET_RECENT_CAPTURES'
  | 'SCRAPE_PAGE';

export type ExtensionMessage = {
  type: MessageType;
  payload?: unknown;
};

export type ExtensionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

// Settings
export type ExtensionSettings = {
  twentyAppUrl: string;
  twentyApiUrl: string;
};

// GraphQL Response Types
export type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
    path?: string[];
  }>;
};

export type PeopleQueryResult = {
  people: {
    edges: Array<{
      node: TwentyPerson;
    }>;
  };
};

export type CompaniesQueryResult = {
  companies: {
    edges: Array<{
      node: TwentyCompany;
    }>;
  };
};

export type CreatePersonResult = {
  createPerson: TwentyPerson;
};

export type CreateCompanyResult = {
  createCompany: TwentyCompany;
};
