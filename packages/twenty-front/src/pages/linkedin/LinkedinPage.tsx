import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppPath, FeatureFlagKey } from 'twenty-shared/types';
import { IconBrandLinkedin } from 'twenty-ui/icon';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { useDebounce } from 'use-debounce';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useUniboxThreads } from '@/unibox/hooks/useUniboxThreads';
import { type UniboxFilters } from '@/unibox/types/UniboxThread';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import {
  LinkedinFilterBar,
  type LinkedinTab,
} from '~/pages/linkedin/components/LinkedinFilterBar';
import { LinkedinHeaderActions } from '~/pages/linkedin/components/LinkedinHeaderActions';
import { UniboxLinkedInConnectionsTable } from '~/pages/unibox/components/UniboxLinkedInConnectionsTable';
import { UniboxLinkedInInvitationsTable } from '~/pages/unibox/components/UniboxLinkedInInvitationsTable';
import { UniboxLinkedInThreadView } from '~/pages/unibox/components/UniboxLinkedInThreadView';
import { UniboxSplitView } from '~/pages/unibox/components/UniboxSplitView';
import { UniboxThreadList } from '~/pages/unibox/components/UniboxThreadList';

const DEFAULT_FILTERS: UniboxFilters = {
  accountIds: [],
  recordListId: null,
  onlyCrmContacts: false,
  unreadOnly: false,
  dateRange: 'ALL',
  search: '',
};

const StyledLoading = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
`;

const LinkedinPageContent = () => {
  const [tab, setTab] = useState<LinkedinTab>('INBOX');
  const [filters, setFilters] = useState<UniboxFilters>(DEFAULT_FILTERS);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [checkedThreadIds, setCheckedThreadIds] = useState<string[]>([]);
  const [debouncedSearch] = useDebounce(filters.search, 300);
  const apolloCoreClient = useApolloCoreClient();
  const queryFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [debouncedSearch, filters],
  );
  const {
    threads,
    totalCount,
    loading,
    isFetchingMore,
    fetchMoreThreads,
    refetch,
  } = useUniboxThreads({
    channel: 'LINKEDIN',
    folder: 'INBOX',
    filters: queryFilters,
    skip: tab !== 'INBOX',
  });

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    if (!threads.some(({ id }) => id === selectedThreadId)) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThreadId, threads]);

  const selectedThread =
    threads.find(({ id }) => id === selectedThreadId) ?? null;

  const clearSelection = () => {
    setSelectedThreadId(null);
    setCheckedThreadIds([]);
  };

  const updateFilters = (update: Partial<UniboxFilters>) => {
    clearSelection();
    setFilters((currentFilters) => ({ ...currentFilters, ...update }));
  };

  const handleTabChange = (nextTab: LinkedinTab) => {
    clearSelection();
    setTab(nextTab);
  };

  return (
    <PageContainer>
      <PageCardLayout
        showInformationBanner={false}
        header={
          <PageCardHeader
            icon={<IconBrandLinkedin size={18} />}
            title={t`LinkedIn`}
            actionButton={
              <LinkedinHeaderActions
                onRefresh={() => {
                  if (tab === 'INBOX') {
                    void refetch();
                    return;
                  }

                  void apolloCoreClient.refetchQueries({ include: 'active' });
                }}
              />
            }
          />
        }
        secondaryBar={
          <LinkedinFilterBar
            tab={tab}
            search={filters.search}
            recordListId={filters.recordListId}
            onlyCrmContacts={filters.onlyCrmContacts}
            unreadOnly={filters.unreadOnly}
            dateRange={filters.dateRange}
            onTabChange={handleTabChange}
            onSearchChange={(search) => updateFilters({ search })}
            onRecordListChange={(recordListId) =>
              updateFilters({ recordListId })
            }
            onOnlyCrmContactsChange={(onlyCrmContacts) =>
              updateFilters({ onlyCrmContacts })
            }
            onUnreadOnlyChange={(unreadOnly) => updateFilters({ unreadOnly })}
            onDateRangeChange={(dateRange) => updateFilters({ dateRange })}
          />
        }
      >
        {tab === 'INBOX' ? (
          <UniboxSplitView
            summary={t`${totalCount} synchronized conversations`}
            list={
              <UniboxThreadList
                threads={threads}
                selectedThreadId={selectedThreadId}
                checkedThreadIds={checkedThreadIds}
                loading={loading}
                isFetchingMore={isFetchingMore}
                onSelectThread={setSelectedThreadId}
                onCheckThread={(threadId, checked) =>
                  setCheckedThreadIds((currentIds) =>
                    checked
                      ? [...new Set([...currentIds, threadId])]
                      : currentIds.filter((id) => id !== threadId),
                  )
                }
                onClearChecked={() => setCheckedThreadIds([])}
                onFetchMore={() => void fetchMoreThreads()}
              />
            }
            detail={
              loading && selectedThread === null ? (
                <StyledLoading>{t`Loading LinkedIn messages…`}</StyledLoading>
              ) : (
                <UniboxLinkedInThreadView
                  key={selectedThread?.id ?? 'empty'}
                  summary={selectedThread}
                />
              )
            }
          />
        ) : tab === 'SENT_REQUESTS' ? (
          <UniboxLinkedInInvitationsTable
            search={queryFilters.search}
            dateRange={queryFilters.dateRange}
          />
        ) : (
          <UniboxLinkedInConnectionsTable
            search={queryFilters.search}
            dateRange={queryFilters.dateRange}
          />
        )}
      </PageCardLayout>
    </PageContainer>
  );
};

export const LinkedinPage = () => {
  const isUniboxEnabled = useIsFeatureEnabled(FeatureFlagKey.IS_UNIBOX_ENABLED);
  const isLinkedinMetadataAvailable = useDoObjectMetadataItemsExist([
    'linkedinConnection',
    'linkedinInvitation',
    'linkedinMessageThread',
    'linkedinMessage',
    'linkedinThreadParticipant',
  ]);

  if (!isUniboxEnabled || !isLinkedinMetadataAvailable) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  return <LinkedinPageContent />;
};
