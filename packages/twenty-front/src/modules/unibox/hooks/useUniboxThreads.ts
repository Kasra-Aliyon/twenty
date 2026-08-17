import { NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useState } from 'react';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { UNIBOX_THREADS } from '@/unibox/graphql/queries/uniboxThreads';
import {
  type UniboxDateRange,
  type UniboxFilters,
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
    afterLastMessageAt?: string;
    afterThreadId?: string;
    page: number;
    pageSize: number;
  };
};

export const useUniboxThreads = ({
  channel,
  folder,
  filters,
  skip = false,
}: {
  channel: UniboxThreadsVariables['input']['channel'];
  folder: UniboxThreadsVariables['input']['folder'];
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
      channel,
      folder,
      connectedAccountIds:
        channel === 'EMAIL' && filters.accountIds.length > 0
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
  const queryKey = JSON.stringify(variables.input);
  const [isEndReached, setIsEndReached] = useState(false);

  useEffect(() => {
    setIsEndReached(false);
  }, [queryKey]);

  const { data, loading, networkStatus, fetchMore, refetch, error } = useQuery<
    UniboxThreadsData,
    UniboxThreadsVariables
  >(UNIBOX_THREADS, {
    client: apolloCoreClient,
    variables,
    skip,
    notifyOnNetworkStatusChange: true,
  });

  const threads = (data?.uniboxThreads.threads ?? []).filter(
    (thread) => thread.channel === channel,
  );
  const totalCount = data?.uniboxThreads.totalCount ?? 0;
  const hasNextPage = !isEndReached && threads.length < totalCount;

  const fetchMoreThreads = async () => {
    if (!hasNextPage || networkStatus === NetworkStatus.fetchMore) {
      return;
    }

    const lastThread = threads.at(-1);

    if (!lastThread) {
      return;
    }

    const result = await fetchMore({
      variables: {
        input: {
          ...variables.input,
          afterLastMessageAt: lastThread.lastMessageAt,
          afterThreadId: lastThread.id,
        },
      },
      updateQuery: (previousData, { fetchMoreResult }) => ({
        uniboxThreads: {
          ...fetchMoreResult.uniboxThreads,
          totalCount: previousData.uniboxThreads.totalCount,
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

    setIsEndReached(
      (result.data?.uniboxThreads.threads.length ?? 0) < UNIBOX_PAGE_SIZE,
    );
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
