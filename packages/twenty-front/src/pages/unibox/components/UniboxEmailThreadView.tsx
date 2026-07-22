import { styled } from '@linaria/react';
import { type KeyboardEvent, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { IconArrowBackUp, IconSend, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { EmailComposerFields } from '@/activities/emails/components/EmailComposerFields';
import { EmailThreadMessage } from '@/activities/emails/components/EmailThreadMessage';
import { useEmailComposerState } from '@/activities/emails/hooks/useEmailComposerState';
import { useEmailThread } from '@/activities/emails/hooks/useEmailThread';
import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { EmailThreadIntermediaryMessages } from '@/page-layout/widgets/email-thread/components/EmailThreadIntermediaryMessages';
import { useUniboxDrafts } from '@/unibox/hooks/useUniboxDrafts';
import { type UniboxThread } from '@/unibox/types/UniboxThread';
import { getUniboxReplyTo } from '@/unibox/utils/getUniboxReplyTo';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { UniboxDraftComposer } from '~/pages/unibox/components/UniboxDraftComposer';
import { t } from '@lingui/core/macro';

const StyledRoot = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`;

const StyledThreadHeader = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledMessages = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 ${themeCssVariables.spacing[3]};
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

const StyledReplyBar = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.primary};
  border: 0;
  border-top: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  font-family: inherit;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
  text-align: left;
`;

const StyledComposer = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.medium};
  max-height: 55%;
  overflow-y: auto;
`;

const StyledComposerActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]}
    ${themeCssVariables.spacing[3]};
`;

const UniboxInlineReplyComposer = ({
  connectedAccountId,
  defaultTo,
  defaultSubject,
  defaultInReplyTo,
  onClose,
  onSent,
}: {
  connectedAccountId: string;
  defaultTo: string;
  defaultSubject: string;
  defaultInReplyTo: string;
  onClose: () => void;
  onSent: () => void;
}) => {
  const composerState = useEmailComposerState({
    connectedAccountId,
    defaultTo,
    defaultSubject,
    defaultInReplyTo,
    onSent: () => {
      onSent();
      onClose();
    },
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (composerState.canSend) void composerState.handleSend();
    }
  };

  return (
    <StyledComposer onKeyDown={handleKeyDown}>
      <EmailComposerFields composerState={composerState} />
      <StyledComposerActions>
        <Button
          title={t`Cancel`}
          Icon={IconX}
          variant="secondary"
          size="small"
          onClick={onClose}
        />
        <Button
          title={t`Send`}
          Icon={IconSend}
          size="small"
          disabled={!composerState.canSend}
          isLoading={composerState.loading}
          onClick={() => void composerState.handleSend()}
        />
      </StyledComposerActions>
    </StyledComposer>
  );
};

const UniboxPersistedReplyComposer = ({
  authorId,
  messageThreadId,
  connectedAccountId,
  defaultTo,
  defaultSubject,
  defaultInReplyTo,
  onClose,
  onSent,
}: {
  authorId: string;
  messageThreadId: string;
  connectedAccountId: string;
  defaultTo: string;
  defaultSubject: string;
  defaultInReplyTo: string;
  onClose: () => void;
  onSent: () => void;
}) => {
  const { records: existingDrafts, loading } = useUniboxDrafts({
    authorId,
    messageThreadId,
  });
  const draft = existingDrafts[0] ?? null;

  if (loading) {
    return <StyledEmpty>{t`Loading draft…`}</StyledEmpty>;
  }

  return (
    <UniboxDraftComposer
      key={messageThreadId}
      draft={draft}
      connectedAccountId={draft?.connectedAccountId ?? connectedAccountId}
      defaultTo={draft?.to ?? defaultTo}
      defaultCc={draft?.cc}
      defaultBcc={draft?.bcc}
      defaultSubject={draft?.subject ?? defaultSubject}
      defaultBody={draft?.body}
      inReplyTo={draft?.inReplyTo ?? defaultInReplyTo}
      messageThreadId={messageThreadId}
      mode="INLINE"
      onCancel={onClose}
      onSent={() => {
        onSent();
        onClose();
      }}
    />
  );
};

export const UniboxEmailThreadView = ({
  summary,
  onSent,
}: {
  summary: UniboxThread | null;
  onSent: () => void;
}) => {
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const isMessageDraftMetadataAvailable = useDoObjectMetadataItemsExist([
    'messageDraft',
  ]);
  const {
    messages,
    connectedAccountId,
    connectedAccountHandle,
    threadLoading,
    messageChannelLoading,
    fetchMoreMessages,
  } = useEmailThread(summary?.id ?? null);

  if (!summary) {
    return <StyledEmpty>{t`Select a conversation to read it.`}</StyledEmpty>;
  }

  if (threadLoading && messages.length === 0) {
    return <StyledEmpty>{t`Loading conversation…`}</StyledEmpty>;
  }

  if (messages.length === 0) {
    return (
      <StyledEmpty>{t`This conversation has no synced messages.`}</StyledEmpty>
    );
  }

  const messageCount = messages.length;
  const hasIntermediaryMessages = messageCount >= 5;
  const firstMessages = messages.slice(
    0,
    hasIntermediaryMessages ? 2 : messageCount - 1,
  );
  const intermediaryMessages = hasIntermediaryMessages
    ? messages.slice(2, messageCount - 1)
    : [];
  const lastMessage = messages[messageCount - 1];
  const rawSubject = lastMessage.subject || summary.subject || '';
  const replySubject = rawSubject.startsWith('Re: ')
    ? rawSubject
    : `Re: ${rawSubject}`;
  const replyConnectedAccountId =
    summary.connectedAccountId ?? connectedAccountId;
  const canReply =
    isDefined(replyConnectedAccountId) &&
    (isDefined(summary.connectedAccountId) || !messageChannelLoading) &&
    isDefined(lastMessage);
  const replyTo = getUniboxReplyTo({
    messages,
    connectedAccountHandle,
    fallbackHandle: summary.participants[0]?.handle ?? '',
  });

  return (
    <StyledRoot key={summary.id}>
      <StyledThreadHeader>
        {summary.subject || t`(No subject)`}
      </StyledThreadHeader>
      <StyledMessages>
        {firstMessages.map((message) => (
          <EmailThreadMessage
            key={message.id}
            sender={message.sender}
            participants={message.messageParticipants}
            body={message.text}
            sentAt={message.receivedAt}
          />
        ))}
        <EmailThreadIntermediaryMessages messages={intermediaryMessages} />
        <EmailThreadMessage
          key={lastMessage.id}
          sender={lastMessage.sender}
          participants={lastMessage.messageParticipants}
          body={lastMessage.text}
          sentAt={lastMessage.receivedAt}
          isExpanded
          hideBottomBorder
        />
        <CustomResolverFetchMoreLoader
          loading={threadLoading}
          onLastRowVisible={fetchMoreMessages}
        />
      </StyledMessages>
      {canReply && !isComposerOpen && (
        <StyledReplyBar type="button" onClick={() => setIsComposerOpen(true)}>
          <IconArrowBackUp size={16} />
          {t`Reply…`}
        </StyledReplyBar>
      )}
      {canReply &&
        isComposerOpen &&
        isMessageDraftMetadataAvailable &&
        currentWorkspaceMember && (
          <UniboxPersistedReplyComposer
            authorId={currentWorkspaceMember.id}
            messageThreadId={summary.id}
            connectedAccountId={replyConnectedAccountId}
            defaultTo={replyTo}
            defaultSubject={replySubject}
            defaultInReplyTo={lastMessage.headerMessageId ?? ''}
            onClose={() => setIsComposerOpen(false)}
            onSent={onSent}
          />
        )}
      {canReply &&
        isComposerOpen &&
        (!isMessageDraftMetadataAvailable || !currentWorkspaceMember) && (
          <UniboxInlineReplyComposer
            key={summary.id}
            connectedAccountId={replyConnectedAccountId}
            defaultTo={replyTo}
            defaultSubject={replySubject}
            defaultInReplyTo={lastMessage.headerMessageId ?? ''}
            onClose={() => setIsComposerOpen(false)}
            onSent={onSent}
          />
        )}
    </StyledRoot>
  );
};
