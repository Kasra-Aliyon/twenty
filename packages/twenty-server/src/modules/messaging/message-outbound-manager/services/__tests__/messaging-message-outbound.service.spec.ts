import { ConnectedAccountProvider } from 'twenty-shared/types';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { EmailGroupMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/email-group/services/email-group-message-outbound.service';
import { GmailMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/gmail/services/gmail-message-outbound.service';
import { ImapSmtpMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/imap/services/imap-smtp-message-outbound.service';
import { MicrosoftMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/microsoft/services/microsoft-message-outbound.service';
import { MessagingMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/services/messaging-message-outbound.service';
import { type SendMessageInput } from 'src/modules/messaging/message-outbound-manager/types/send-message-input.type';

describe('MessagingMessageOutboundService', () => {
  const sendMessage = jest.fn().mockResolvedValue({
    headerMessageId: 'message-id',
  });
  const createDraft = jest.fn().mockResolvedValue(undefined);
  const getWorkspace = jest.fn();

  const service = new MessagingMessageOutboundService(
    { sendMessage, createDraft } as unknown as GmailMessageOutboundService,
    {} as MicrosoftMessageOutboundService,
    {} as ImapSmtpMessageOutboundService,
    {} as EmailGroupMessageOutboundService,
    { get: getWorkspace } as unknown as CoreEntityCacheService,
  );

  const connectedAccount = {
    id: 'connected-account-id',
    workspaceId: '20202020-2020-4020-8020-202020202020',
    provider: ConnectedAccountProvider.GOOGLE,
  } as ConnectedAccountEntity;

  const sendMessageInput: SendMessageInput = {
    to: 'recipient@example.com',
    subject: 'Hello',
    body: 'Plain text body',
    html: '<p>HTML body</p>',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should enforce plain text for sent messages and drafts when enabled', async () => {
    getWorkspace.mockResolvedValue({ isPlainTextEmailEnabled: true });

    await service.sendMessage(sendMessageInput, connectedAccount);
    await service.createDraft(sendMessageInput, connectedAccount);

    expect(sendMessage).toHaveBeenCalledWith(
      { ...sendMessageInput, isPlainTextOnly: true },
      connectedAccount,
    );
    expect(createDraft).toHaveBeenCalledWith(
      { ...sendMessageInput, isPlainTextOnly: true },
      connectedAccount,
    );
  });

  it('should preserve multipart email when plain text is disabled', async () => {
    getWorkspace.mockResolvedValue({ isPlainTextEmailEnabled: false });

    await service.sendMessage(sendMessageInput, connectedAccount);

    expect(sendMessage).toHaveBeenCalledWith(
      sendMessageInput,
      connectedAccount,
    );
  });
});
