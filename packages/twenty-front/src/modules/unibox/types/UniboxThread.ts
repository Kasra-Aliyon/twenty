export type UniboxTab = 'EMAILS' | 'SENT' | 'DRAFT' | 'LINKEDIN';

export type UniboxDateRange =
  | 'ALL'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS';

export type UniboxThreadParticipant = {
  displayName: string | null;
  handle: string;
  avatarUrl: string | null;
  personId: string | null;
};

export type UniboxThread = {
  id: string;
  channel: 'EMAIL' | 'LINKEDIN';
  subject: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  messageCount: number;
  isRead: boolean;
  participants: UniboxThreadParticipant[];
  hasCrmContact: boolean;
  connectedAccountId: string | null;
};

export type UniboxFilters = {
  accountIds: string[];
  recordListId: string | null;
  onlyCrmContacts: boolean;
  unreadOnly: boolean;
  dateRange: UniboxDateRange;
  search: string;
};

export type UniboxContact = {
  handle: string;
  displayName: string | null;
  personId: string | null;
  messageCount: number;
  lastContactedAt: string;
  firstContactedAt: string;
};

export type UniboxContactSince =
  | 'LIFETIME'
  | 'LAST_YEAR'
  | 'LAST_90_DAYS'
  | 'LAST_30_DAYS';

export type UniboxContactCrmFilter = 'NOT_IN_CRM' | 'IN_CRM' | 'ALL';
