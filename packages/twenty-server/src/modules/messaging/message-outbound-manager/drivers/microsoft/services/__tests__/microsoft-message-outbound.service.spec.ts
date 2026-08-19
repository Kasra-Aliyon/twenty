import { ConnectedAccountProvider } from 'twenty-shared/types';

import { MicrosoftOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/microsoft/microsoft-oauth2-client.provider';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MicrosoftMessageOutboundService } from 'src/modules/messaging/message-outbound-manager/drivers/microsoft/services/microsoft-message-outbound.service';
import { type SendMessageInput } from 'src/modules/messaging/message-outbound-manager/types/send-message-input.type';

describe('MicrosoftMessageOutboundService', () => {
  const createMessage = jest.fn().mockResolvedValue({
    id: 'message-id',
    internetMessageId: 'internet-message-id',
  });
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const api = jest.fn((path: string) => ({
    post: path === '/me/messages' ? createMessage : sendMessage,
  }));
  const microsoftClient = { api };
  const service = new MicrosoftMessageOutboundService({
    getClient: jest.fn().mockResolvedValue(microsoftClient),
  } as unknown as MicrosoftOAuth2ClientProvider);

  const connectedAccount = {
    id: 'connected-account-id',
    workspaceId: '20202020-2020-4020-8020-202020202020',
    provider: ConnectedAccountProvider.MICROSOFT,
  } as ConnectedAccountEntity;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should send the text body with the Microsoft Text content type', async () => {
    const input: SendMessageInput = {
      to: 'recipient@example.com',
      subject: 'Hello',
      body: 'Plain text body',
      html: '<p>HTML body</p>',
      isPlainTextOnly: true,
    };

    const onProviderStart = jest.fn().mockResolvedValue(undefined);

    await service.sendMessage(input, connectedAccount, onProviderStart);

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          contentType: 'Text',
          content: 'Plain text body',
        },
      }),
    );
    expect(createMessage.mock.invocationCallOrder[0]).toBeLessThan(
      onProviderStart.mock.invocationCallOrder[0],
    );
    expect(onProviderStart.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0],
    );
  });
});
