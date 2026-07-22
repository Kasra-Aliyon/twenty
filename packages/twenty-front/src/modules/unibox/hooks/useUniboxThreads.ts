import { NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { UNIBOX_THREADS } from '@/unibox/graphql/queries/uniboxThreads';
import {
  type UniboxDateRange,
  type UniboxFilters,
  type UniboxTab,
  type UniboxThread,
} from '@/unibox/types/UniboxThread';

const UNIBOX_PAGE_SIZE = 30;

const UNIBOX_DATE_RANGE_IN_DAYS: Record<
  Exclude<UniboxDateRange, 'ALL'>,
  number
> = {
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
};

const getDateFrom = (dateRange: UniboxDateRange) => {
  if (dateRange === 'ALL') return undefined;

  const dateFrom = new Date();

  dateFrom.setDate(dateFrom.getDate() - UNIBOX_DATE_RANGE_IN_DAYS[dateRange]);

  return dateFrom.toISOString();
};

type UniboxThreadsData = {
  uniboxThreads: {
    totalCount: number;
    threads: UniboxThread[];
  };
};

type UniboxThreadsVariables = {
  input: {
    channel: 'EMAIL' | 'LINKEDIN';
    folder: 'INBOX' | 'SENT';
    connectedAccountIds?: string[];
    recordListId?: string;
    onlyCrmContacts: boolean;
    unreadOnly: boolean;
    dateFrom?: string;
    search?: string;
    page: number;
    pageSize: number;
  };
};

export const useUniboxThreads = ({
  tab,
  filters,
  skip = false,
}: {
  tab: UniboxTab;
  filters: UniboxFilters;
  skip?: boolean;
}) => {
  const apolloCoreClient = useApolloCoreClient();
  const dateFrom = useMemo(
    () => getDateFrom(filters.dateRange),
    [filters.dateRange],
  );
  const variables: UniboxThreadsVariables = {
    input: {
      channel: tab === 'LINKEDIN' ? 'LINKEDIN' : 'EMAIL',
      folder: tab === 'SENT' ? 'SENT' : 'INBOX',
      connectedAccountIds:
        tab !== 'LINKEDIN' && filters.accountIds.length > 0
          ? filters.accountIds
          : undefined,
      recordListId: filters.recordListId ?? undefined,
      onlyCrmContacts: filters.onlyCrmContacts,
      unreadOnly: filters.unreadOnly,
      dateFrom,
      search: filters.search.trim() || undefined,
      page: 1,
      pageSize: UNIBOX_PAGE_SIZE,
    },
  };

  const { data, loading, networkStatus, fetchMore, refetch, error } = useQuery<
    UniboxThreadsData,
    UniboxThreadsVariables
  >(UNIBOX_THREADS, {
    client: apolloCoreClient,
    variables,
    skip,
    notifyOnNetworkStatusChange: true,
  });

  const expectedChannel = tab === 'LINKEDIN' ? 'LINKEDIN' : 'EMAIL';
  const threads = (data?.uniboxThreads.threads ?? []).filter(
    ({ channel }) => channel === expectedChannel,
  );
  const totalCount = data?.uniboxThreads.totalCount ?? 0;
  const hasNextPage = threads.length < totalCount;

  const fetchMoreThreads = async () => {
    if (!hasNextPage || networkStatus === NetworkStatus.fetchMore) {
      return;
    }

    const nextPage = Math.floor(threads.length / UNIBOX_PAGE_SIZE) + 1;

    await fetchMore({
      variables: { input: { ...variables.input, page: nextPage } },
      updateQuery: (previousData, { fetchMoreResult }) => ({
        uniboxThreads: {
          ...fetchMoreResult.uniboxThreads,
          threads: [
            ...previousData.uniboxThreads.threads,
            ...fetchMoreResult.uniboxThreads.threads.filter(
              (thread) =>
                !previousData.uniboxThreads.threads.some(
                  (currentThread) => currentThread.id === thread.id,
                ),
            ),
          ],
        },
      }),
    });
  };

  return {
    threads,
    totalCount,
    loading: loading && networkStatus !== NetworkStatus.fetchMore,
    isFetchingMore: networkStatus === NetworkStatus.fetchMore,
    hasNextPage,
    fetchMoreThreads,
    refetch,
    error,
  };
};
