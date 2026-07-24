import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { type UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const USER_WORKSPACE_ID = '20202020-2222-4222-8222-222222222222';
const CONNECTED_ACCOUNT_ID = '20202020-3333-4333-8333-333333333333';
const WORKSPACE_MEMBER_ID = '20202020-4444-4444-8444-444444444444';
const USER_ID = '20202020-5555-4555-8555-555555555555';

describe('SequenceSenderService', () => {
  const connectedAccountRepository = {
    findOne: jest.fn(),
  };
  const messageChannelRepository = {
    findOne: jest.fn(),
  };
  const userWorkspaceRepository = {
    findOne: jest.fn(),
  };
  const workspaceMemberRepository = {
    findOne: jest.fn(),
  };
  const globalWorkspaceOrmManager = {
    getRepository: jest.fn().mockResolvedValue(workspaceMemberRepository),
  };
  const service = new SequenceSenderService(
    connectedAccountRepository as unknown as Repository<ConnectedAccountEntity>,
    messageChannelRepository as unknown as Repository<MessageChannelEntity>,
    userWorkspaceRepository as unknown as Repository<UserWorkspaceEntity>,
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
  );
  const connectedAccount = {
    id: CONNECTED_ACCOUNT_ID,
    handle: 'sender@example.com',
    provider: ConnectedAccountProvider.GOOGLE,
    userWorkspaceId: USER_WORKSPACE_ID,
    workspaceId: WORKSPACE_ID,
  } as ConnectedAccountEntity;
  const messageChannel = {
    connectedAccountId: CONNECTED_ACCOUNT_ID,
    handle: connectedAccount.handle,
    isSyncEnabled: true,
    syncStatus: MessageChannelSyncStatus.ACTIVE,
    workspaceId: WORKSPACE_ID,
  } as MessageChannelEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    connectedAccountRepository.findOne.mockResolvedValue(connectedAccount);
    messageChannelRepository.findOne.mockResolvedValue(messageChannel);
    userWorkspaceRepository.findOne.mockResolvedValue({
      userId: USER_ID,
    } as UserWorkspaceEntity);
    workspaceMemberRepository.findOne.mockResolvedValue({
      id: WORKSPACE_MEMBER_ID,
    } as WorkspaceMemberWorkspaceEntity);
  });

  it('accepts only an authenticated sender with active inbox sync', async () => {
    await expect(
      service.getReadySenderOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        expectedUserWorkspaceId: USER_WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toEqual({ connectedAccount, messageChannel });

    expect(connectedAccountRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: CONNECTED_ACCOUNT_ID,
          userWorkspaceId: USER_WORKSPACE_ID,
          workspaceId: WORKSPACE_ID,
        }),
      }),
    );
    expect(messageChannelRepository.findOne).toHaveBeenCalledWith({
      where: {
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        handle: connectedAccount.handle,
        isSyncEnabled: true,
        syncStatus: MessageChannelSyncStatus.ACTIVE,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it('rejects a sender whose inbox is not actively syncing', async () => {
    messageChannelRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getReadySenderOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('Enable inbox sync');
  });

  it('maps the sender account owner to the LinkedIn workspace member', async () => {
    await expect(
      service.getOwnerWorkspaceMemberIdOrThrow({
        connectedAccount,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toBe(WORKSPACE_MEMBER_ID);

    expect(workspaceMemberRepository.findOne).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: ['id'],
    });
  });
});
