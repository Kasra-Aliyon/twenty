import { styled } from '@linaria/react';
import { format } from 'date-fns';
import { Avatar } from 'twenty-ui/data-display';
import { Checkbox } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { type UniboxThread } from '@/unibox/types/UniboxThread';
import { groupThreadsByDate } from '@/unibox/utils/groupThreadsByDate';
import { UniboxAddToRecordListButton } from '~/pages/unibox/components/UniboxRecordListControls';
import { t } from '@lingui/core/macro';

const StyledList = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
`;

const StyledGroupLabel = styled.div`
  background: ${themeCssVariables.background.secondary};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  position: sticky;
  top: 0;
  z-index: 1;
`;

const StyledRow = styled.div<{ isSelected: boolean; isRead: boolean }>`
  align-items: center;
  background: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.background.transparent.blue
      : themeCssVariables.background.primary};
  border: 0;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: grid;
  font-family: inherit;
  gap: ${themeCssVariables.spacing[2]};
  grid-template-columns: 20px 32px minmax(0, 1fr) auto;
  padding: ${themeCssVariables.spacing[3]};
  text-align: left;
  width: 100%;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

const StyledMain = styled.div`
  min-width: 0;
`;

const StyledName = styled.div<{ isRead: boolean }>`
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${({ isRead }) =>
    isRead
      ? themeCssVariables.font.weight.medium
      : themeCssVariables.font.weight.semiBold};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledSubject = styled.div`
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledPreview = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledMeta = styled.div`
  align-items: flex-end;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  padding: ${themeCssVariables.spacing[8]};
  text-align: center;
`;

const StyledSelectionBar = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border-top: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledClear = styled.button`
  all: unset;
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
`;

export const UniboxThreadList = ({
  threads,
  selectedThreadId,
  checkedThreadIds,
  loading,
  isFetchingMore,
  onSelectThread,
  onCheckThread,
  onClearChecked,
  onFetchMore,
}: {
  threads: UniboxThread[];
  selectedThreadId: string | null;
  checkedThreadIds: string[];
  loading: boolean;
  isFetchingMore: boolean;
  onSelectThread: (threadId: string) => void;
  onCheckThread: (threadId: string, checked: boolean) => void;
  onClearChecked: () => void;
  onFetchMore: () => void;
}) => {
  const selectedPersonIds = threads
    .filter((thread) => checkedThreadIds.includes(thread.id))
    .flatMap((thread) => thread.participants.map(({ personId }) => personId))
    .filter((personId): personId is string => personId !== null);

  return (
    <StyledList>
      {loading && threads.length === 0 && (
        <StyledEmpty>{t`Loading messages…`}</StyledEmpty>
      )}
      {!loading && threads.length === 0 && (
        <StyledEmpty>{t`No messages match these filters.`}</StyledEmpty>
      )}
      {groupThreadsByDate(threads).map((group) => (
        <div key={group.label}>
          <StyledGroupLabel>{group.label}</StyledGroupLabel>
          {group.threads.map((thread) => {
            const leadParticipant = thread.participants[0];
            const participantLabel =
              leadParticipant?.displayName ||
              leadParticipant?.handle ||
              t`Unknown contact`;

            return (
              <StyledRow
                key={thread.id}
                role="button"
                tabIndex={0}
                isSelected={selectedThreadId === thread.id}
                isRead={thread.isRead}
                onClick={() => onSelectThread(thread.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectThread(thread.id);
                  }
                }}
              >
                <span onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={checkedThreadIds.includes(thread.id)}
                    onCheckedChange={(checked) =>
                      onCheckThread(thread.id, checked)
                    }
                    aria-label={t`Select ${participantLabel}`}
                  />
                </span>
                <Avatar
                  avatarUrl={leadParticipant?.avatarUrl}
                  placeholder={participantLabel}
                  placeholderColorSeed={
                    leadParticipant?.personId || leadParticipant?.handle
                  }
                  size="sm"
                  type="rounded"
                />
                <StyledMain>
                  <StyledName isRead={thread.isRead}>
                    {participantLabel}
                  </StyledName>
                  <StyledSubject>
                    {thread.subject || t`(No subject)`}
                  </StyledSubject>
                  <StyledPreview>{thread.lastMessagePreview}</StyledPreview>
                </StyledMain>
                <StyledMeta>
                  <span>{format(new Date(thread.lastMessageAt), 'd MMM')}</span>
                  {thread.messageCount > 1 && (
                    <span>{thread.messageCount}</span>
                  )}
                </StyledMeta>
              </StyledRow>
            );
          })}
        </div>
      ))}
      <CustomResolverFetchMoreLoader
        loading={isFetchingMore}
        onLastRowVisible={onFetchMore}
      />
      {checkedThreadIds.length > 0 && (
        <StyledSelectionBar>
          <StyledClear type="button" onClick={onClearChecked}>
            {t`${checkedThreadIds.length} selected`} ×
          </StyledClear>
          <UniboxAddToRecordListButton personIds={selectedPersonIds} />
        </StyledSelectionBar>
      )}
    </StyledList>
  );
};
