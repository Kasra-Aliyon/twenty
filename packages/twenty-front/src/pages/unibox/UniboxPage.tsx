import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppPath, FeatureFlagKey } from 'twenty-shared/types';
import { IconInbox } from 'twenty-ui/icon';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { useDebounce } from 'use-debounce';

import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useUniboxAccounts } from '@/unibox/hooks/useUniboxAccounts';
import { useUniboxThreads } from '@/unibox/hooks/useUniboxThreads';
import {
  type UniboxFilters,
  type UniboxTab,
} from '@/unibox/types/UniboxThread';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import {
  UNIBOX_CONTACTS_MODAL_ID,
  UniboxContactsModal,
} from '~/pages/unibox/components/UniboxContactsModal';
import { UniboxDraftTab } from '~/pages/unibox/components/UniboxDraftTab';
import { UniboxEmailThreadView } from '~/pages/unibox/components/UniboxEmailThreadView';
import { UniboxFilterBar } from '~/pages/unibox/components/UniboxFilterBar';
import { UniboxHeaderActions } from '~/pages/unibox/components/UniboxHeader';
import { UniboxLinkedInThreadView } from '~/pages/unibox/components/UniboxLinkedInThreadView';
import { UniboxSplitView } from '~/pages/unibox/components/UniboxSplitView';
import { UniboxThreadList } from '~/pages/unibox/components/UniboxThreadList';
import { t } from '@lingui/core/macro';

const DEFAULT_FILTERS: UniboxFilters = {
  accountIds: [],
  recordListId: null,
  onlyCrmContacts: false,
  unreadOnly: false,
  dateRange: 'ALL',
  search: '',
};

const StyledDetailLoading = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
`;

const UniboxPageContent = () => {
  const [tab, setTab] = useState<UniboxTab>('EMAILS');
  const [filters, setFilters] = useState<UniboxFilters>(DEFAULT_FILTERS);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [checkedThreadIds, setCheckedThreadIds] = useState<string[]>([]);
  const [debouncedSearch] = useDebounce(filters.search, 300);
  const { accounts } = useUniboxAccounts();
  const { openModal } = useModal();
  const apolloCoreClient = useApolloCoreClient();
  const isMessageDraftMetadataAvailable = useDoObjectMetadataItemsExist([
    'messageDraft',
  ]);
  const isEmailThreadMetadataAvailable = useDoObjectMetadataItemsExist([
    'messageThread',
    'message',
    'messageParticipant',
    'messageChannelMessageAssociation',
  ]);
  const isLinkedinMetadataAvailable = useDoObjectMetadataItemsExist([
    'linkedinMessageThread',
    'linkedinMessage',
    'linkedinThreadParticipant',
  ]);

  const queryFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [debouncedSearch, filters],
  );
  const { threads, loading, isFetchingMore, fetchMoreThreads, refetch } =
    useUniboxThreads({
      tab,
      filters: queryFilters,
      skip:
        tab === 'DRAFT' || (tab === 'LINKEDIN' && !isLinkedinMetadataAvailable),
    });

  useEffect(() => {
    if (tab === 'LINKEDIN' && !isLinkedinMetadataAvailable) {
      setTab('EMAILS');
      return;
    }

    if (tab === 'DRAFT' && !isMessageDraftMetadataAvailable) {
      setTab('EMAILS');
    }
  }, [isLinkedinMetadataAvailable, isMessageDraftMetadataAvailable, tab]);

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

  return (
    <PageContainer>
      <PageCardLayout
        showInformationBanner={false}
        header={
          <PageCardHeader
            icon={<IconInbox size={18} />}
            title={t`Messages`}
            actionButton={
              <UniboxHeaderActions
                tab={tab}
                accounts={accounts}
                selectedAccountIds={filters.accountIds}
                onlyCrmContacts={filters.onlyCrmContacts}
                isDraftEnabled={isMessageDraftMetadataAvailable}
                isLinkedinEnabled={isLinkedinMetadataAvailable}
                onTabChange={(nextTab) => {
                  clearSelection();
                  setTab(nextTab);
                }}
                onToggleAccount={(accountId) =>
                  updateFilters({
                    accountIds: filters.accountIds.includes(accountId)
                      ? filters.accountIds.filter((id) => id !== accountId)
                      : [...filters.accountIds, accountId],
                  })
                }
                onOnlyCrmContactsChange={(onlyCrmContacts) =>
                  updateFilters({ onlyCrmContacts })
                }
                onOpenContacts={() => openModal(UNIBOX_CONTACTS_MODAL_ID)}
                onRefresh={() => {
                  if (tab === 'DRAFT') {
                    void apolloCoreClient.refetchQueries({
                      include: ['FindManyMessageDrafts'],
                    });
                    return;
                  }

                  void refetch();
                }}
              />
            }
          />
        }
        secondaryBar={
          tab === 'DRAFT' ? undefined : (
            <UniboxFilterBar
              search={filters.search}
              recordListId={filters.recordListId}
              unreadOnly={filters.unreadOnly}
              dateRange={filters.dateRange}
              onSearchChange={(search) => updateFilters({ search })}
              onRecordListChange={(recordListId) =>
                updateFilters({ recordListId })
              }
              onUnreadOnlyChange={(unreadOnly) => updateFilters({ unreadOnly })}
              onDateRangeChange={(dateRange) => updateFilters({ dateRange })}
            />
          )
        }
      >
        {tab === 'DRAFT' && isMessageDraftMetadataAvailable ? (
          <UniboxDraftTab accounts={accounts} />
        ) : (
          <UniboxSplitView
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
              tab === 'LINKEDIN' && isLinkedinMetadataAvailable ? (
                <UniboxLinkedInThreadView
                  key={selectedThread?.id ?? 'empty'}
                  summary={selectedThread}
                />
              ) : isEmailThreadMetadataAvailable ? (
                <UniboxEmailThreadView
                  key={`${tab}-${selectedThread?.id ?? 'empty'}`}
                  summary={selectedThread}
                  onSent={() => void refetch()}
                />
              ) : (
                <StyledDetailLoading>{t`Loading messages…`}</StyledDetailLoading>
              )
            }
          />
        )}
        <UniboxContactsModal />
      </PageCardLayout>
    </PageContainer>
  );
};

export const UniboxPage = () => {
  const isUniboxEnabled = useIsFeatureEnabled(FeatureFlagKey.IS_UNIBOX_ENABLED);

  if (!isUniboxEnabled) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  return <UniboxPageContent />;
};
