import { styled } from '@linaria/react';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useUniboxDrafts } from '@/unibox/hooks/useUniboxDrafts';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { UniboxDraftComposer } from '~/pages/unibox/components/UniboxDraftComposer';
import { UniboxSplitView } from '~/pages/unibox/components/UniboxSplitView';
import { t } from '@lingui/core/macro';

const StyledList = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
`;

const StyledListHeader = styled.div`
  background: ${themeCssVariables.background.secondary};
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledDraftRow = styled.button<{ isSelected: boolean }>`
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
  gap: ${themeCssVariables.spacing[1]};
  grid-template-columns: minmax(0, 1fr) auto;
  padding: ${themeCssVariables.spacing[3]};
  text-align: left;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

const StyledRecipient = styled.div`
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledSubject = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledPreview = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  grid-column: 1 / -1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledTime = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
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

const StyledComposerPane = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
`;

const StyledComposerTitle = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: ${themeCssVariables.spacing[4]};
`;

export const UniboxDraftTab = ({
  accounts,
}: {
  accounts: { id: string; handle: string }[];
}) => {
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const {
    records: drafts,
    loading,
    refetch,
  } = useUniboxDrafts({ authorId: currentWorkspaceMember?.id ?? '' });

  useEffect(() => {
    if (drafts.length === 0) {
      setSelectedDraftId(null);
      return;
    }

    if (!drafts.some(({ id }) => id === selectedDraftId)) {
      setSelectedDraftId(drafts[0].id);
    }
  }, [drafts, selectedDraftId]);

  const selectedDraft = drafts.find(({ id }) => id === selectedDraftId) ?? null;

  if (!currentWorkspaceMember) {
    return (
      <StyledEmpty>{t`Your workspace member could not be loaded.`}</StyledEmpty>
    );
  }

  return (
    <UniboxSplitView
      list={
        <StyledList>
          <StyledListHeader>{t`Saved drafts`}</StyledListHeader>
          {drafts.map((draft) => (
            <StyledDraftRow
              key={draft.id}
              type="button"
              isSelected={draft.id === selectedDraftId}
              onClick={() => setSelectedDraftId(draft.id)}
            >
              <StyledRecipient>{draft.to || t`No recipients`}</StyledRecipient>
              <StyledTime>
                {format(new Date(draft.lastEditedAt), 'd MMM, HH:mm')}
              </StyledTime>
              <StyledSubject>{draft.subject || t`(No subject)`}</StyledSubject>
              <StyledPreview>
                {draft.body.replace(/<[^>]+>/g, ' ')}
              </StyledPreview>
            </StyledDraftRow>
          ))}
          {loading && drafts.length === 0 && (
            <StyledEmpty>{t`Loading drafts…`}</StyledEmpty>
          )}
          {!loading && drafts.length === 0 && (
            <StyledEmpty>{t`No saved drafts yet.`}</StyledEmpty>
          )}
        </StyledList>
      }
      detail={
        selectedDraft ? (
          <StyledComposerPane>
            <StyledComposerTitle>
              {selectedDraft.subject || t`(No subject)`}
            </StyledComposerTitle>
            <UniboxDraftComposer
              key={selectedDraft.id}
              draft={selectedDraft}
              authorId={currentWorkspaceMember.id}
              connectedAccountId={
                selectedDraft.connectedAccountId || accounts[0]?.id || ''
              }
              defaultTo={selectedDraft.to}
              defaultCc={selectedDraft.cc}
              defaultBcc={selectedDraft.bcc}
              defaultSubject={selectedDraft.subject}
              defaultBody={selectedDraft.body}
              inReplyTo={selectedDraft.inReplyTo}
              messageThreadId={selectedDraft.messageThreadId}
              mode="DRAFT"
              onSent={() => void refetch()}
              onDiscard={() => void refetch()}
            />
          </StyledComposerPane>
        ) : (
          <StyledEmpty>{t`Select a draft to continue writing.`}</StyledEmpty>
        )
      }
    />
  );
};
