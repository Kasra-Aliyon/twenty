import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IsNull, Repository } from 'typeorm';

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

  async getReadySenderOrThrow({
    connectedAccountId,
    expectedUserWorkspaceId,
    workspaceId,
  }: {
    connectedAccountId: string;
    expectedUserWorkspaceId?: string;
    workspaceId: string;
  }): Promise<ReadySequenceSender> {
    const connectedAccount = await this.connectedAccountRepository.findOne({
      where: {
        id: connectedAccountId,
        workspaceId,
        archivedAt: IsNull(),
        authFailedAt: IsNull(),
        ...(isDefined(expectedUserWorkspaceId)
          ? { userWorkspaceId: expectedUserWorkspaceId }
          : {}),
      },
    });

    if (!isDefined(connectedAccount)) {
      throw new Error(
        'Choose an active sender mailbox that belongs to your workspace account',
      );
    }

    if (!SEQUENCE_SENDER_PROVIDERS.has(connectedAccount.provider)) {
      throw new Error('The selected account cannot send sequence email');
    }

    const messageChannel = await this.messageChannelRepository.findOne({
      where: {
        connectedAccountId,
        handle: connectedAccount.handle,
        isSyncEnabled: true,
        syncStatus: MessageChannelSyncStatus.ACTIVE,
        workspaceId,
      },
    });

    if (!isDefined(messageChannel)) {
      throw new Error(
        'Enable inbox sync and wait for the selected sender mailbox to finish syncing',
      );
    }

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
    const connectedAccount = await this.connectedAccountRepository.findOne({
      where: {
        id: connectedAccountId,
        workspaceId,
        ...(isDefined(expectedUserWorkspaceId)
          ? { userWorkspaceId: expectedUserWorkspaceId }
          : {}),
      },
    });

    if (!isDefined(connectedAccount)) {
      throw new Error(
        'The sequence sender account is no longer available in this workspace',
      );
    }

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
      throw new Error('The sequence sender no longer belongs to the workspace');
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
      throw new Error(
        'The sequence sender is not linked to an active workspace member',
      );
    }

    return workspaceMember.id;
  }
}
