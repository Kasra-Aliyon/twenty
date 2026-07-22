import { styled } from '@linaria/react';
import { type KeyboardEvent, useEffect } from 'react';
import { IconSend, IconTrash, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { EmailComposerFields } from '@/activities/emails/components/EmailComposerFields';
import { useEmailComposerState } from '@/activities/emails/hooks/useEmailComposerState';
import { useUniboxDraft } from '@/unibox/hooks/useUniboxDraft';
import { type MessageDraftRecord } from '@/unibox/types/MessageDraftRecord';
import { t } from '@lingui/core/macro';

const StyledComposer = styled.div<{ isFullPage: boolean }>`
  display: flex;
  flex: ${({ isFullPage }) => (isFullPage ? 1 : 'initial')};
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
`;

const StyledActions = styled.div`
  align-items: center;
  border-top: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledSaveStatus = styled.span<{ isError: boolean }>`
  color: ${({ isError }) =>
    isError
      ? themeCssVariables.color.red
      : themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-right: auto;
`;

type UniboxDraftComposerProps = {
  draft: MessageDraftRecord | null;
  authorId: string;
  connectedAccountId: string;
  defaultTo: string;
  defaultCc?: string;
  defaultBcc?: string;
  defaultSubject: string;
  defaultBody?: string;
  inReplyTo?: string | null;
  messageThreadId?: string | null;
  mode: 'INLINE' | 'DRAFT';
  onCancel?: () => void;
  onSent: () => void | Promise<void>;
  onDiscard?: () => void | Promise<void>;
};

export const UniboxDraftComposer = ({
  draft,
  authorId,
  connectedAccountId,
  defaultTo,
  defaultCc = '',
  defaultBcc = '',
  defaultSubject,
  defaultBody = '',
  inReplyTo = null,
  messageThreadId = null,
  mode,
  onCancel,
  onSent,
  onDiscard,
}: UniboxDraftComposerProps) => {
  const draftPersistence = useUniboxDraft({
    initialDraftId: draft?.id ?? null,
    authorId,
  });
  const { scheduleSave } = draftPersistence;
  const composerState = useEmailComposerState({
    connectedAccountId,
    defaultTo,
    defaultCc,
    defaultBcc,
    defaultSubject,
    defaultBody,
    defaultInReplyTo: inReplyTo ?? undefined,
    onSent: async () => {
      draftPersistence.cancelPendingSave();
      await draftPersistence.discardDraft();
      await onSent();
    },
  });

  useEffect(() => {
    const isPersistedDraftUnchanged =
      draft !== null &&
      composerState.connectedAccountId === connectedAccountId &&
      composerState.to === defaultTo &&
      composerState.cc === defaultCc &&
      composerState.bcc === defaultBcc &&
      composerState.subject === defaultSubject &&
      composerState.body === defaultBody;

    if (isPersistedDraftUnchanged) {
      scheduleSave.cancel();
      return;
    }

    scheduleSave({
      connectedAccountId: composerState.connectedAccountId,
      to: composerState.to,
      cc: composerState.cc,
      bcc: composerState.bcc,
      subject: composerState.subject,
      body: composerState.body,
      inReplyTo,
      messageThreadId,
    });
  }, [
    composerState.bcc,
    composerState.body,
    composerState.cc,
    composerState.connectedAccountId,
    composerState.subject,
    composerState.to,
    connectedAccountId,
    defaultBcc,
    defaultBody,
    defaultCc,
    defaultSubject,
    defaultTo,
    draft,
    inReplyTo,
    messageThreadId,
    scheduleSave,
  ]);

  const handleCancel = async () => {
    try {
      await draftPersistence.flushPendingSave();
    } finally {
      onCancel?.();
    }
  };

  const handleDiscard = async () => {
    await draftPersistence.discardDraft();
    await onDiscard?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (composerState.canSend) void composerState.handleSend();
    }
  };

  return (
    <StyledComposer isFullPage={mode === 'DRAFT'} onKeyDown={handleKeyDown}>
      <EmailComposerFields composerState={composerState} />
      <StyledActions>
        <StyledSaveStatus isError={draftPersistence.saveError !== null}>
          {draftPersistence.saveError
            ? t`Draft could not be saved`
            : draftPersistence.isSaving
              ? t`Saving draft…`
              : draftPersistence.draftId
                ? t`Draft saved`
                : ''}
        </StyledSaveStatus>
        {mode === 'INLINE' ? (
          <Button
            title={t`Cancel`}
            Icon={IconX}
            variant="secondary"
            size="small"
            onClick={() => void handleCancel()}
          />
        ) : (
          <Button
            title={t`Discard`}
            Icon={IconTrash}
            variant="secondary"
            size="small"
            onClick={() => void handleDiscard()}
          />
        )}
        <Button
          title={t`Send`}
          Icon={IconSend}
          size="small"
          disabled={!composerState.canSend}
          isLoading={composerState.loading}
          onClick={() => void composerState.handleSend()}
        />
      </StyledActions>
    </StyledComposer>
  );
};
