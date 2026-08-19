import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type EntityManager, IsNull, Repository } from 'typeorm';

import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const SEQUENCE_SENDER_PROVIDERS = new Set<ConnectedAccountProvider>([
  ConnectedAccountProvider.GOOGLE,
  ConnectedAccountProvider.MICROSOFT,
  ConnectedAccountProvider.IMAP_SMTP_CALDAV,
]);

type ReadySequenceSender = {
  connectedAccount: ConnectedAccountEntity;
  messageChannel: MessageChannelEntity;
};

// A mailbox that is merely mid-sync is not broken, it is busy: syncStatus
// cycles through ONGOING on every import. Callers must be able to wait for it
// instead of ending the enrollment, so the transient case gets its own class.
export class SequenceSenderNotReadyError extends Error {}

// Callers may safely turn this business-state failure into a terminal sequence
// outcome. Repository and transaction errors intentionally keep their original
// types so a temporary database outage never burns an enrollment.
export class SequenceSenderUnavailableError extends Error {}

@Injectable()
export class SequenceSenderService {
  constructor(
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // LinkedIn steps only need the account to identify its owning workspace
  // member: the browser runner carries its own LinkedIn session and never
  // touches the mailbox. Requiring a synced inbox here would fail LinkedIn-only
  // sequences whenever the unrelated email import happens to be running.
  async getSenderAccountOrThrow({
    connectedAccountId,
    expectedUserWorkspaceId,
    workspaceId,
  }: {
    connectedAccountId: string;
    expectedUserWorkspaceId?: string;
    workspaceId: string;
  }): Promise<ConnectedAccountEntity> {
    const connectedAccount = await this.connectedAccountRepository.findOne({
      where: {
        id: connectedAccountId,
        workspaceId,
        archivedAt: IsNull(),
        ...(isDefined(expectedUserWorkspaceId)
          ? { userWorkspaceId: expectedUserWorkspaceId }
          : {}),
      },
    });

    this.assertSenderAccountAvailable(connectedAccount);

    return connectedAccount;
  }

  async withLockedSenderAccountOrThrow<TResult>({
    connectedAccountId,
    expectedUserWorkspaceId,
    operation,
    shouldRequireReadyMailbox = false,
    workspaceId,
  }: {
    connectedAccountId: string;
    expectedUserWorkspaceId?: string;
    operation: (
      connectedAccount: ConnectedAccountEntity,
      transactionManager: EntityManager,
    ) => Promise<TResult>;
    shouldRequireReadyMailbox?: boolean;
    workspaceId: string;
  }): Promise<TResult> {
    return this.connectedAccountRepository.manager.transaction(
      async (transactionManager) => {
        const connectedAccount = await transactionManager.findOne(
          ConnectedAccountEntity,
          {
            where: {
              id: connectedAccountId,
              workspaceId,
              archivedAt: IsNull(),
              ...(isDefined(expectedUserWorkspaceId)
                ? { userWorkspaceId: expectedUserWorkspaceId }
                : {}),
            },
            lock: { mode: 'pessimistic_write' },
          },
        );

        this.assertSenderAccountAvailable(connectedAccount);

        if (shouldRequireReadyMailbox) {
          this.assertEmailAuthenticationAvailable(connectedAccount);
          const messageChannel = await transactionManager.findOne(
            MessageChannelEntity,
            {
              where: {
                connectedAccountId,
                handle: connectedAccount.handle,
                workspaceId,
              },
              lock: { mode: 'pessimistic_write' },
            },
          );

          this.assertMessageChannelReady(messageChannel);
        }

        // Keep the core account row locked until the workspace operation has
        // committed. Archival and claim therefore have one unambiguous winner.
        return operation(connectedAccount, transactionManager);
      },
    );
  }

  async getReadySenderOrThrow({
    connectedAccountId,
    expectedUserWorkspaceId,
    workspaceId,
  }: {
    connectedAccountId: string;
    expectedUserWorkspaceId?: string;
    workspaceId: string;
  }): Promise<ReadySequenceSender> {
    const connectedAccount = await this.getSenderAccountOrThrow({
      connectedAccountId,
      expectedUserWorkspaceId,
      workspaceId,
    });

    this.assertEmailAuthenticationAvailable(connectedAccount);

    const messageChannel = await this.messageChannelRepository.findOne({
      where: {
        connectedAccountId,
        handle: connectedAccount.handle,
        workspaceId,
      },
    });

    this.assertMessageChannelReady(messageChannel);

    return { connectedAccount, messageChannel };
  }

  async getSenderOwnerWorkspaceMemberIdOrThrow({
    connectedAccountId,
    expectedUserWorkspaceId,
    workspaceId,
  }: {
    connectedAccountId: string;
    expectedUserWorkspaceId?: string;
    workspaceId: string;
  }): Promise<string> {
    const connectedAccount = await this.getSenderAccountOrThrow({
      connectedAccountId,
      expectedUserWorkspaceId,
      workspaceId,
    });

    return this.getOwnerWorkspaceMemberIdOrThrow({
      connectedAccount,
      workspaceId,
    });
  }

  async getOwnerWorkspaceMemberIdOrThrow({
    connectedAccount,
    workspaceId,
  }: {
    connectedAccount: ConnectedAccountEntity;
    workspaceId: string;
  }): Promise<string> {
    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: {
        id: connectedAccount.userWorkspaceId,
        workspaceId,
      },
      select: ['userId'],
    });

    if (!isDefined(userWorkspace)) {
      throw new SequenceSenderUnavailableError(
        'The sequence sender no longer belongs to the workspace',
      );
    }

    const workspaceMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        WorkspaceMemberWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const workspaceMember = await workspaceMemberRepository.findOne({
      where: { userId: userWorkspace.userId },
      select: ['id'],
    });

    if (!isDefined(workspaceMember)) {
      throw new SequenceSenderUnavailableError(
        'The sequence sender is not linked to an active workspace member',
      );
    }

    return workspaceMember.id;
  }

  private assertSenderAccountAvailable(
    connectedAccount: ConnectedAccountEntity | null,
  ): asserts connectedAccount is ConnectedAccountEntity {
    if (!isDefined(connectedAccount)) {
      throw new SequenceSenderUnavailableError(
        'Choose an active sender account that belongs to your workspace account',
      );
    }

    if (!SEQUENCE_SENDER_PROVIDERS.has(connectedAccount.provider)) {
      throw new SequenceSenderUnavailableError(
        'The selected account cannot be used as a sequence sender',
      );
    }
  }

  private assertEmailAuthenticationAvailable(
    connectedAccount: ConnectedAccountEntity,
  ): void {
    if (isDefined(connectedAccount.authFailedAt)) {
      throw new SequenceSenderUnavailableError(
        'Reconnect the selected sender mailbox: its authentication has expired',
      );
    }
  }

  private assertMessageChannelReady(
    messageChannel: MessageChannelEntity | null,
  ): asserts messageChannel is MessageChannelEntity {
    if (!isDefined(messageChannel) || !messageChannel.isSyncEnabled) {
      throw new SequenceSenderUnavailableError(
        'Enable inbox sync for the selected sender mailbox',
      );
    }

    if (messageChannel.syncStatus === MessageChannelSyncStatus.ONGOING) {
      throw new SequenceSenderNotReadyError(
        'Wait for the selected sender mailbox to finish its current sync',
      );
    }

    if (
      messageChannel.syncStatus ===
      MessageChannelSyncStatus.FAILED_INSUFFICIENT_PERMISSIONS
    ) {
      throw new SequenceSenderUnavailableError(
        'Reconnect the selected sender mailbox and grant the required inbox permissions',
      );
    }

    if (messageChannel.syncStatus === MessageChannelSyncStatus.FAILED_UNKNOWN) {
      throw new SequenceSenderUnavailableError(
        'Reconnect the selected sender mailbox because inbox sync failed',
      );
    }

    if (messageChannel.syncStatus !== MessageChannelSyncStatus.ACTIVE) {
      throw new SequenceSenderUnavailableError(
        'Finish setting up inbox sync for the selected sender mailbox',
      );
    }
  }
}
