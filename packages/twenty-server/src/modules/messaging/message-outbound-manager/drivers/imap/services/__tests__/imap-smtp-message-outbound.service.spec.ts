import { ConnectedAccountProvider } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';
import { type ImapClientProvider } from 'src/modules/messaging/message-import-manager/drivers/imap/providers/imap-client.provider';
import { type ImapFindDraftsFolderService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-find-drafts-folder.service';
import { type SmtpClientProvider } from 'src/modules/messaging/message-import-manager/drivers/smtp/providers/smtp-client.provider';
import { ImapSmtpMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/imap/services/imap-smtp-message-outbound.service';

describe('ImapSmtpMessageOutboundService', () => {
  beforeAll(() => jest.useRealTimers());
  afterAll(() => jest.useFakeTimers());

  it('keeps the SMTP delivery successful when sent-folder append fails', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const append = jest.fn().mockRejectedValue(new Error('IMAP unavailable'));
    const closeClient = jest.fn().mockResolvedValue(undefined);
    const service = new ImapSmtpMessageOutboundService(
      {
        getClient: jest.fn().mockResolvedValue({ sendMail }),
      } as unknown as SmtpClientProvider,
      {
        getClient: jest.fn().mockResolvedValue({ append }),
        closeClient,
      } as unknown as ImapClientProvider,
      {} as ImapFindDraftsFolderService,
      {
        findOne: jest.fn().mockResolvedValue({ id: 'message-channel-id' }),
      } as unknown as Repository<MessageChannelEntity>,
      {
        findOne: jest.fn().mockResolvedValue({ externalId: 'Sent' }),
      } as unknown as Repository<MessageFolderEntity>,
    );
    const connectedAccount = {
      id: 'connected-account-id',
      handle: 'sender@example.com',
      provider: ConnectedAccountProvider.IMAP_SMTP_CALDAV,
      connectionParameters: { IMAP: {} },
    } as ConnectedAccountEntity;
    const onProviderStart = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.sendMessage(
        {
          body: 'Hello',
          html: '<p>Hello</p>',
          subject: 'Subject',
          to: 'recipient@example.com',
        },
        connectedAccount,
        onProviderStart,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        headerMessageId: expect.any(String),
        sentAt: expect.any(String),
      }),
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(onProviderStart.mock.invocationCallOrder[0]).toBeLessThan(
      sendMail.mock.invocationCallOrder[0],
    );
    expect(append).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledTimes(1);
  });
});
