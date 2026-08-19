import { Injectable } from '@nestjs/common';

import { ConnectedAccountProvider } from 'twenty-shared/types';
import { assertUnreachable } from 'twenty-shared/utils';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { EmailGroupMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/email-group/services/email-group-message-outbound.service';
import { GmailMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/gmail/services/gmail-message-outbound.service';
import { ImapSmtpMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/imap/services/imap-smtp-message-outbound.service';
import { MicrosoftMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/microsoft/services/microsoft-message-outbound.service';
import { SendMessageInput } from 'src/modules/messaging/message-outbound-manager/types/send-message-input.type';
import { type SendMessageResult } from 'src/modules/messaging/message-outbound-manager/types/send-message-result.type';

@Injectable()
export class MessagingMessageOutboundService {
  constructor(
    private readonly gmailMessageOutboundService: GmailMessageOutboundService,
    private readonly microsoftMessageOutboundService: MicrosoftMessageOutboundService,
    private readonly imapSmtpMessageOutboundService: ImapSmtpMessageOutboundService,
    private readonly emailGroupMessageOutboundService: EmailGroupMessageOutboundService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
  ) {}

  public async sendMessage(
    sendMessageInput: SendMessageInput,
    connectedAccount: ConnectedAccountEntity,
    onProviderStart?: () => Promise<void>,
  ): Promise<SendMessageResult> {
    const resolvedSendMessageInput = await this.resolveSendMessageInput(
      sendMessageInput,
      connectedAccount.workspaceId,
    );

    switch (connectedAccount.provider) {
      case ConnectedAccountProvider.GOOGLE:
        return this.gmailMessageOutboundService.sendMessage(
          resolvedSendMessageInput,
          connectedAccount,
          onProviderStart,
        );
      case ConnectedAccountProvider.MICROSOFT:
        return this.microsoftMessageOutboundService.sendMessage(
          resolvedSendMessageInput,
          connectedAccount,
          onProviderStart,
        );
      case ConnectedAccountProvider.IMAP_SMTP_CALDAV:
        return this.imapSmtpMessageOutboundService.sendMessage(
          resolvedSendMessageInput,
          connectedAccount,
          onProviderStart,
        );
      case ConnectedAccountProvider.EMAIL_GROUP:
        return this.emailGroupMessageOutboundService.sendMessage(
          resolvedSendMessageInput,
          connectedAccount,
          onProviderStart,
        );
      case ConnectedAccountProvider.OIDC:
      case ConnectedAccountProvider.SAML:
      case ConnectedAccountProvider.APP:
        throw new Error(
          `Provider ${connectedAccount.provider} does not support sending messages`,
        );
      default:
        assertUnreachable(
          connectedAccount.provider,
          `Provider ${connectedAccount.provider} not supported for sending messages`,
        );
    }
  }

  public async createDraft(
    sendMessageInput: SendMessageInput,
    connectedAccount: ConnectedAccountEntity,
  ): Promise<void> {
    const resolvedSendMessageInput = await this.resolveSendMessageInput(
      sendMessageInput,
      connectedAccount.workspaceId,
    );

    switch (connectedAccount.provider) {
      case ConnectedAccountProvider.GOOGLE:
        return this.gmailMessageOutboundService.createDraft(
          resolvedSendMessageInput,
          connectedAccount,
        );
      case ConnectedAccountProvider.MICROSOFT:
        return this.microsoftMessageOutboundService.createDraft(
          resolvedSendMessageInput,
          connectedAccount,
        );
      case ConnectedAccountProvider.IMAP_SMTP_CALDAV:
        return this.imapSmtpMessageOutboundService.createDraft(
          resolvedSendMessageInput,
          connectedAccount,
        );
      case ConnectedAccountProvider.EMAIL_GROUP:
      case ConnectedAccountProvider.OIDC:
      case ConnectedAccountProvider.SAML:
      case ConnectedAccountProvider.APP:
        throw new Error(
          `Provider ${connectedAccount.provider} does not support creating drafts`,
        );
      default:
        assertUnreachable(
          connectedAccount.provider,
          `Provider ${connectedAccount.provider} not supported for creating drafts`,
        );
    }
  }

  private async resolveSendMessageInput(
    sendMessageInput: SendMessageInput,
    workspaceId: string,
  ): Promise<SendMessageInput> {
    const workspace = await this.coreEntityCacheService.get(
      'workspaceEntity',
      workspaceId,
    );

    return workspace?.isPlainTextEmailEnabled
      ? { ...sendMessageInput, isPlainTextOnly: true }
      : sendMessageInput;
  }
}
