import { MessageChannelType } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { UNIBOX_UNREAD_FOLDER_NAME } from 'src/engine/core-modules/unibox/constants/unibox.constants';
import { UniboxEmailChannelService } from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';

describe('UniboxEmailChannelService', () => {
  const workspaceId = 'workspace-id';
  const userWorkspaceId = 'user-workspace-id';
  let connectedAccountRepository: jest.Mocked<
    Pick<Repository<ConnectedAccountEntity>, 'find'>
  >;
  let messageChannelRepository: jest.Mocked<
    Pick<Repository<MessageChannelEntity>, 'find'>
  >;
  let messageFolderRepository: jest.Mocked<
    Pick<Repository<MessageFolderEntity>, 'find'>
  >;
  let service: UniboxEmailChannelService;

  beforeEach(() => {
    connectedAccountRepository = {
      find: jest.fn(),
    };
    messageChannelRepository = {
      find: jest.fn(),
    };
    messageFolderRepository = {
      find: jest.fn(),
    };
    service = new UniboxEmailChannelService(
      connectedAccountRepository as unknown as Repository<ConnectedAccountEntity>,
      messageChannelRepository as unknown as Repository<MessageChannelEntity>,
      messageFolderRepository as unknown as Repository<MessageFolderEntity>,
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

  it('should resolve unread folder ids for the given channels', async () => {
    messageFolderRepository.find.mockResolvedValue([
      { id: 'unread-folder-id' } as MessageFolderEntity,
    ]);

    const result = await service.getUnreadFolderIds(['channel-id']);

    expect(messageFolderRepository.find).toHaveBeenCalledWith({
      where: {
        messageChannelId: expect.anything(),
        name: UNIBOX_UNREAD_FOLDER_NAME,
      },
      select: { id: true },
    });
    expect(result).toEqual(['unread-folder-id']);
  });

  it('should not query unread folders when no channel is owned', async () => {
    const result = await service.getUnreadFolderIds([]);

    expect(messageFolderRepository.find).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
