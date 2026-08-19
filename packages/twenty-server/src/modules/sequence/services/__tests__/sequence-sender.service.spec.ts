import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { type UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import {
  SequenceSenderNotReadyError,
  SequenceSenderService,
  SequenceSenderUnavailableError,
} from 'src/modules/sequence/services/sequence-sender.service';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const USER_WORKSPACE_ID = '20202020-2222-4222-8222-222222222222';
const CONNECTED_ACCOUNT_ID = '20202020-3333-4333-8333-333333333333';
const WORKSPACE_MEMBER_ID = '20202020-4444-4444-8444-444444444444';
const USER_ID = '20202020-5555-4555-8555-555555555555';

describe('SequenceSenderService', () => {
  const connectedAccountTransactionManager = {
    findOne: jest.fn(),
  };
  const connectedAccountTransaction = jest.fn(async (operation) =>
    operation(connectedAccountTransactionManager),
  );
  const connectedAccountRepository = {
    findOne: jest.fn(),
    manager: {
      transaction: connectedAccountTransaction,
    },
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
    connectedAccountTransactionManager.findOne.mockResolvedValue(
      connectedAccount,
    );
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
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it('holds a pessimistic account lock around a sender-dependent operation', async () => {
    const operationTimeline: string[] = [];
    const operation = jest.fn(async () => {
      operationTimeline.push('operation-completed');

      return 'claimed';
    });

    connectedAccountTransaction.mockImplementationOnce(async (callback) => {
      operationTimeline.push('transaction-started');
      const result = await callback(connectedAccountTransactionManager);

      operationTimeline.push('transaction-committed');

      return result;
    });
    connectedAccountTransactionManager.findOne.mockImplementationOnce(
      async () => {
        operationTimeline.push('account-locked');

        return connectedAccount;
      },
    );

    await expect(
      service.withLockedSenderAccountOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        expectedUserWorkspaceId: USER_WORKSPACE_ID,
        operation,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toBe('claimed');

    expect(connectedAccountTransactionManager.findOne).toHaveBeenCalledWith(
      ConnectedAccountEntity,
      {
        where: {
          id: CONNECTED_ACCOUNT_ID,
          userWorkspaceId: USER_WORKSPACE_ID,
          workspaceId: WORKSPACE_ID,
          archivedAt: expect.anything(),
        },
        lock: { mode: 'pessimistic_write' },
      },
    );
    expect(operation).toHaveBeenCalledWith(
      connectedAccount,
      connectedAccountTransactionManager,
    );
    expect(operationTimeline).toEqual([
      'transaction-started',
      'account-locked',
      'operation-completed',
      'transaction-committed',
    ]);
  });

  it.each([
    {
      scenario: 'authentication failed',
      lockedAccount: {
        ...connectedAccount,
        authFailedAt: new Date('2026-08-17T10:00:00.000Z'),
      },
      lockedChannel: messageChannel,
      expectedError: SequenceSenderUnavailableError,
    },
    {
      scenario: 'inbox sync started',
      lockedAccount: connectedAccount,
      lockedChannel: {
        ...messageChannel,
        syncStatus: MessageChannelSyncStatus.ONGOING,
      },
      expectedError: SequenceSenderNotReadyError,
    },
  ])(
    'rechecks email readiness under the sender lock when $scenario',
    async ({ expectedError, lockedAccount, lockedChannel }) => {
      const operation = jest.fn();

      connectedAccountTransactionManager.findOne.mockResolvedValueOnce(
        lockedAccount,
      );

      if (expectedError === SequenceSenderNotReadyError) {
        connectedAccountTransactionManager.findOne.mockResolvedValueOnce(
          lockedChannel,
        );
      }

      await expect(
        service.withLockedSenderAccountOrThrow({
          connectedAccountId: CONNECTED_ACCOUNT_ID,
          operation,
          shouldRequireReadyMailbox: true,
          workspaceId: WORKSPACE_ID,
        }),
      ).rejects.toBeInstanceOf(expectedError);
      expect(operation).not.toHaveBeenCalled();

      if (expectedError === SequenceSenderNotReadyError) {
        expect(
          connectedAccountTransactionManager.findOne,
        ).toHaveBeenNthCalledWith(2, MessageChannelEntity, {
          where: {
            connectedAccountId: CONNECTED_ACCOUNT_ID,
            handle: connectedAccount.handle,
            workspaceId: WORKSPACE_ID,
          },
          lock: { mode: 'pessimistic_write' },
        });
      }
    },
  );

  it.each([
    {
      scenario: 'archived',
      senderAccount: null,
      expectedMessage: 'Choose an active sender account',
    },
    {
      scenario: 'unsupported',
      senderAccount: {
        ...connectedAccount,
        provider: ConnectedAccountProvider.OIDC,
      },
      expectedMessage: 'cannot be used as a sequence sender',
    },
  ])(
    'rejects a sender that became $scenario while waiting for the lock',
    async ({ expectedMessage, senderAccount }) => {
      const operation = jest.fn();

      connectedAccountTransactionManager.findOne.mockResolvedValueOnce(
        senderAccount,
      );

      await expect(
        service.withLockedSenderAccountOrThrow({
          connectedAccountId: CONNECTED_ACCOUNT_ID,
          operation,
          workspaceId: WORKSPACE_ID,
        }),
      ).rejects.toMatchObject({
        constructor: SequenceSenderUnavailableError,
        message: expect.stringContaining(expectedMessage),
      });

      expect(operation).not.toHaveBeenCalled();
    },
  );

  it('does not classify a core database outage as sender unavailability', async () => {
    const databaseError = new Error('database unavailable');
    const operation = jest.fn();

    connectedAccountTransaction.mockRejectedValueOnce(databaseError);

    const result = service.withLockedSenderAccountOrThrow({
      connectedAccountId: CONNECTED_ACCOUNT_ID,
      operation,
      workspaceId: WORKSPACE_ID,
    });

    await expect(result).rejects.toBe(databaseError);
    await expect(result).rejects.not.toBeInstanceOf(
      SequenceSenderUnavailableError,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects a sender whose inbox sync is not configured', async () => {
    messageChannelRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getReadySenderOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('Enable inbox sync');
  });

  it('defers only while an enabled inbox is actively syncing', async () => {
    messageChannelRepository.findOne.mockResolvedValue({
      ...messageChannel,
      syncStatus: MessageChannelSyncStatus.ONGOING,
    });

    await expect(
      service.getReadySenderOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toBeInstanceOf(SequenceSenderNotReadyError);
  });

  it.each([
    {
      syncStatus: MessageChannelSyncStatus.NOT_SYNCED,
      expectedMessage: 'Finish setting up inbox sync',
    },
    {
      syncStatus: MessageChannelSyncStatus.FAILED_INSUFFICIENT_PERMISSIONS,
      expectedMessage: 'grant the required inbox permissions',
    },
    {
      syncStatus: MessageChannelSyncStatus.FAILED_UNKNOWN,
      expectedMessage: 'inbox sync failed',
    },
  ])(
    'fails fast when inbox sync has status $syncStatus',
    async ({ expectedMessage, syncStatus }) => {
      messageChannelRepository.findOne.mockResolvedValue({
        ...messageChannel,
        syncStatus,
      });

      await expect(
        service.getReadySenderOrThrow({
          connectedAccountId: CONNECTED_ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
        }),
      ).rejects.toThrow(expectedMessage);
    },
  );

  it('reports expired authentication separately from a missing account', async () => {
    connectedAccountRepository.findOne.mockResolvedValue({
      ...connectedAccount,
      authFailedAt: new Date('2026-08-17T00:00:00.000Z'),
    });

    await expect(
      service.getReadySenderOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('authentication has expired');

    expect(messageChannelRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an unsupported account for LinkedIn-only and email sequences', async () => {
    connectedAccountRepository.findOne.mockResolvedValue({
      ...connectedAccount,
      provider: ConnectedAccountProvider.OIDC,
    });

    await expect(
      service.getSenderAccountOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('cannot be used as a sequence sender');

    await expect(
      service.getReadySenderOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('cannot be used as a sequence sender');

    expect(messageChannelRepository.findOne).not.toHaveBeenCalled();
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

  it('classifies a removed sender owner as permanently unavailable', async () => {
    userWorkspaceRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getOwnerWorkspaceMemberIdOrThrow({
        connectedAccount,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toBeInstanceOf(SequenceSenderUnavailableError);
  });

  it('classifies a missing workspace member as permanently unavailable', async () => {
    workspaceMemberRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getOwnerWorkspaceMemberIdOrThrow({
        connectedAccount,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toBeInstanceOf(SequenceSenderUnavailableError);
  });

  it('resolves manual-action provenance without requiring current inbox sync', async () => {
    messageChannelRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getSenderOwnerWorkspaceMemberIdOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toBe(WORKSPACE_MEMBER_ID);

    expect(connectedAccountRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: CONNECTED_ACCOUNT_ID,
        archivedAt: expect.anything(),
        workspaceId: WORKSPACE_ID,
      },
    });
    expect(messageChannelRepository.findOne).not.toHaveBeenCalled();
  });

  it('stops LinkedIn owner resolution when the sender was archived', async () => {
    connectedAccountRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getSenderOwnerWorkspaceMemberIdOrThrow({
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('Choose an active sender account');

    expect(userWorkspaceRepository.findOne).not.toHaveBeenCalled();
    expect(workspaceMemberRepository.findOne).not.toHaveBeenCalled();
  });
});
