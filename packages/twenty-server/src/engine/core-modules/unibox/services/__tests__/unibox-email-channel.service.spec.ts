import { MessageChannelType } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { UniboxEmailChannelService } from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';

describe('UniboxEmailChannelService', () => {
  const workspaceId = 'workspace-id';
  const userWorkspaceId = 'user-workspace-id';
  let connectedAccountRepository: jest.Mocked<
    Pick<Repository<ConnectedAccountEntity>, 'find'>
  >;
  let messageChannelRepository: jest.Mocked<
    Pick<Repository<MessageChannelEntity>, 'find'>
  >;
  let service: UniboxEmailChannelService;

  beforeEach(() => {
    connectedAccountRepository = {
      find: jest.fn(),
    };
    messageChannelRepository = {
      find: jest.fn(),
    };
    service = new UniboxEmailChannelService(
      connectedAccountRepository as unknown as Repository<ConnectedAccountEntity>,
      messageChannelRepository as unknown as Repository<MessageChannelEntity>,
    );
  });

  it('should resolve only active email channels owned by the current user', async () => {
    connectedAccountRepository.find.mockResolvedValue([
      {
        id: 'account-id',
        handle: ' Owner@Example.com ',
        handleAliases: ['alias@example.com', ''],
      } as ConnectedAccountEntity,
    ]);
    messageChannelRepository.find.mockResolvedValue([
      {
        id: 'channel-id',
        handle: 'ALIAS@example.com',
        connectedAccountId: 'account-id',
      } as MessageChannelEntity,
    ]);

    const result = await service.getOwnedEmailChannelContext({
      workspaceId,
      userWorkspaceId,
      connectedAccountIds: ['account-id', 'unowned-account-id'],
    });

    expect(connectedAccountRepository.find).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId,
        userWorkspaceId,
        archivedAt: expect.anything(),
        id: expect.anything(),
      }),
    });
    expect(messageChannelRepository.find).toHaveBeenCalledWith({
      where: {
        workspaceId,
        connectedAccountId: expect.anything(),
        type: MessageChannelType.EMAIL,
      },
    });
    expect(result.channelIds).toEqual(['channel-id']);
    expect(result.ownedHandles).toEqual([
      'owner@example.com',
      'alias@example.com',
    ]);
    expect(result.connectedAccountIdByChannelId.get('channel-id')).toBe(
      'account-id',
    );
  });

  it('should not query channels when the caller owns no selected account', async () => {
    connectedAccountRepository.find.mockResolvedValue([]);

    const result = await service.getOwnedEmailChannelContext({
      workspaceId,
      userWorkspaceId,
      connectedAccountIds: ['unowned-account-id'],
    });

    expect(messageChannelRepository.find).not.toHaveBeenCalled();
    expect(result).toEqual({
      accounts: [],
      channels: [],
      channelIds: [],
      ownedHandles: [],
      connectedAccountIdByChannelId: new Map(),
    });
  });
});
