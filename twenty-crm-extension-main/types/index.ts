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
