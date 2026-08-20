import { ConnectedAccountProvider } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { type UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';

describe('SequenceSenderService owner row locking', () => {
  it('holds the workspace-member row lock when owner resolution joins a workspace transaction', async () => {
    const workspaceId = 'workspace-id';
    const connectedAccount = {
      id: 'connected-account-id',
      workspaceId,
      userWorkspaceId: 'user-workspace-id',
      provider: ConnectedAccountProvider.GOOGLE,
    } as ConnectedAccountEntity;
    const workspaceEntityManager = {} as WorkspaceEntityManager;
    const connectedAccountRepository = {
      findOne: jest.fn().mockResolvedValue(connectedAccount),
    };
    const userWorkspaceRepository = {
      findOne: jest.fn().mockResolvedValue({ userId: 'user-id' }),
    };
    const workspaceMemberRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'owner-id' }),
    };
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn().mockResolvedValue(workspaceMemberRepository),
    } as unknown as GlobalWorkspaceOrmManager;
    const service = new SequenceSenderService(
      connectedAccountRepository as unknown as Repository<ConnectedAccountEntity>,
      {} as Repository<MessageChannelEntity>,
      userWorkspaceRepository as unknown as Repository<UserWorkspaceEntity>,
      globalWorkspaceOrmManager,
    );

    await expect(
      service.getSenderOwnerWorkspaceMemberIdOrThrow({
        connectedAccountId: connectedAccount.id,
        workspaceEntityManager,
        workspaceId,
      }),
    ).resolves.toBe('owner-id');
    expect(workspaceMemberRepository.findOne).toHaveBeenCalledWith(
      {
        where: { userId: 'user-id' },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );
  });
});
