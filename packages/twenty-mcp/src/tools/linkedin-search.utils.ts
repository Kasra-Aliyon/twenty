import { MAX_LIST_LIMIT, STANDARD_OBJECTS } from '../constants.js';
import {
  combineFilters,
  filterCondition,
  textSearchFilter,
} from '../services/filter-builder.js';
import type { RecordsService } from '../services/records.service.js';

type DateRange = {
  date_from?: string;
  date_to?: string;
};

type SearchText = {
  search?: string;
};

type ContactSearch = {
  contact?: string;
  person_id?: string;
};

type MessageSearchFilters = DateRange &
  SearchText & {
    direction?: 'INBOUND' | 'OUTBOUND';
    thread_id?: string;
  };

type ThreadSearchFilters = DateRange &
  SearchText & {
    contact?: string;
  };

type ConnectionSearchFilters = DateRange & SearchText & ContactSearch;

type InvitationSearchFilters = DateRange &
  SearchText & {
    contact?: string;
    direction?: 'RECEIVED' | 'SENT';
  };

type ParticipantSearchFilters = SearchText &
  ContactSearch & {
    is_self?: boolean;
    thread_id?: string;
  };

type ActionSearchFilters = DateRange &
  SearchText & {
    contact?: string;
    connection_state?: string;
    date_field?: 'created' | 'executed' | 'scheduled';
    person_id?: string;
    status?: string;
    type?: string;
  };

const assertValidDateRange = ({ date_from, date_to }: DateRange): void => {
  if (
    date_from !== undefined &&
    date_to !== undefined &&
    Date.parse(date_from) > Date.parse(date_to)
  ) {
    throw new Error('date_from must be earlier than or equal to date_to.');
  }
};

const dateRangeFilter = (
  field: string,
  range: DateRange,
): string | undefined => {
  assertValidDateRange(range);

  return combineFilters('and', [
    range.date_from === undefined
      ? undefined
      : filterCondition(field, 'gte', range.date_from),
    range.date_to === undefined
      ? undefined
      : filterCondition(field, 'lte', range.date_to),
  ]);
};

export const buildLinkedinMessageSearchFilter = (
  filters: MessageSearchFilters,
  contactThreadIds?: string[],
): string | undefined =>
  combineFilters('and', [
    textSearchFilter(['body', 'senderName'], filters.search),
    filters.direction === undefined
      ? undefined
      : filterCondition('direction', 'eq', filters.direction),
    filters.thread_id === undefined
      ? undefined
      : filterCondition('threadId', 'eq', filters.thread_id),
    contactThreadIds === undefined
      ? undefined
      : filterCondition('threadId', 'in', contactThreadIds),
    dateRangeFilter('deliveredAt', filters),
  ]);

export const buildLinkedinThreadSearchFilter = (
  filters: ThreadSearchFilters,
): string | undefined => {
  assertValidDateRange(filters);

  return combineFilters('and', [
    textSearchFilter(['name', 'lastMessagePreview'], filters.search),
    textSearchFilter(['name'], filters.contact),
    // A thread is a candidate when its recorded conversation span overlaps the
    // requested window. Search messages for exact within-window delivery.
    filters.date_from === undefined
      ? undefined
      : filterCondition('lastMessageTime', 'gte', filters.date_from),
    filters.date_to === undefined
      ? undefined
      : filterCondition('firstMessageTime', 'lte', filters.date_to),
  ]);
};

export const buildLinkedinConnectionSearchFilter = (
  filters: ConnectionSearchFilters,
): string | undefined =>
  combineFilters('and', [
    textSearchFilter(
      [
        'name',
        'handle',
        'headline',
        'linkedinUrn',
        'profileUrl.primaryLinkUrl',
      ],
      filters.search,
    ),
    textSearchFilter(
      ['name', 'handle', 'linkedinUrn', 'profileUrl.primaryLinkUrl'],
      filters.contact,
    ),
    filters.person_id === undefined
      ? undefined
      : filterCondition('personId', 'eq', filters.person_id),
    dateRangeFilter('connectedAt', filters),
  ]);

export const buildLinkedinInvitationSearchFilter = (
  filters: InvitationSearchFilters,
): string | undefined =>
  combineFilters('and', [
    textSearchFilter(['name', 'handle', 'headline', 'message'], filters.search),
    textSearchFilter(['name', 'handle'], filters.contact),
    filters.direction === undefined
      ? undefined
      : filterCondition('direction', 'eq', filters.direction),
    dateRangeFilter('sentAt', filters),
  ]);

export const buildLinkedinParticipantSearchFilter = (
  filters: ParticipantSearchFilters,
): string | undefined =>
  combineFilters('and', [
    textSearchFilter(
      [
        'name',
        'handle',
        'headline',
        'linkedinUrn',
        'linkedinMemberId',
        'profileUrl.primaryLinkUrl',
      ],
      filters.search ?? filters.contact,
    ),
    filters.person_id === undefined
      ? undefined
      : filterCondition('personId', 'eq', filters.person_id),
    filters.thread_id === undefined
      ? undefined
      : filterCondition('threadId', 'eq', filters.thread_id),
    filters.is_self === undefined
      ? undefined
      : filterCondition('isSelf', 'eq', filters.is_self),
  ]);

export const buildLinkedinActionSearchFilter = (
  filters: ActionSearchFilters,
): string | undefined => {
  const dateField =
    filters.date_field === 'created'
      ? 'createdAt'
      : filters.date_field === 'executed'
        ? 'executedAt'
        : 'scheduledAt';

  return combineFilters('and', [
    textSearchFilter(
      ['linkedinUrl', 'noteText', 'errorMessage'],
      filters.search,
    ),
    textSearchFilter(['linkedinUrl'], filters.contact),
    filters.person_id === undefined
      ? undefined
      : filterCondition('personId', 'eq', filters.person_id),
    filters.type === undefined
      ? undefined
      : filterCondition('type', 'eq', filters.type),
    filters.status === undefined
      ? undefined
      : filterCondition('status', 'eq', filters.status),
    filters.connection_state === undefined
      ? undefined
      : filterCondition('connectionState', 'eq', filters.connection_state),
    dateRangeFilter(dateField, filters),
  ]);
};

export const buildLinkedinActionEventDateFilter = (
  range: DateRange,
): string | undefined => {
  assertValidDateRange(range);

  if (range.date_from === undefined && range.date_to === undefined) {
    return undefined;
  }

  const executedRange = dateRangeFilter('executedAt', range);
  const scheduledRange = dateRangeFilter('scheduledAt', range);

  return combineFilters('or', [
    executedRange,
    combineFilters('and', [
      filterCondition('executedAt', 'is', null),
      scheduledRange,
    ]),
  ]);
};

const getThreadId = (item: unknown): string | undefined => {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return undefined;
  }

  const threadId = (item as Record<string, unknown>).threadId;

  return typeof threadId === 'string' ? threadId : undefined;
};

export const resolveLinkedinContactThreadIds = async ({
  records,
  contact,
  personId,
  token,
}: {
  records: RecordsService;
  contact?: string;
  personId?: string;
  token: 'user';
}): Promise<string[] | undefined> => {
  if (contact === undefined && personId === undefined) {
    return undefined;
  }

  const participants = await records.list({
    object: STANDARD_OBJECTS.linkedinThreadParticipants,
    filter: buildLinkedinParticipantSearchFilter({
      contact,
      person_id: personId,
      is_self: false,
    }),
    fields: ['threadId'],
    limit: MAX_LIST_LIMIT,
    depth: 0,
    token,
  });

  if (
    participants.has_more ||
    (participants.total !== null && participants.total > participants.count)
  ) {
    throw new Error(
      `Contact search matched more than ${MAX_LIST_LIMIT} LinkedIn conversation participants. Refine contact or person_id, or use twenty_search_linkedin_participants first.`,
    );
  }

  return [
    ...new Set(
      participants.items
        .map(getThreadId)
        .filter((threadId): threadId is string => threadId !== undefined),
    ),
  ];
};

export const emptyLinkedinSearchResult = () => ({
  total: 0,
  count: 0,
  items: [],
  has_more: false,
  next_cursor: null,
});

export const linkedinSearchUtilsTesting = {
  assertValidDateRange,
  dateRangeFilter,
};
