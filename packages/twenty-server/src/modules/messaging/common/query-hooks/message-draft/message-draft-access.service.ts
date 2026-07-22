import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { MessageChannelType } from 'twenty-shared/types';
import { In, IsNull, type Repository } from 'typeorm';
import { isDefined } from 'twenty-shared/utils';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { STANDARD_ERROR_MESSAGE } from 'src/engine/api/common/common-query-runners/errors/standard-error-message.constant';
import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import {
  type UserWorkspaceAuthContext,
  type WorkspaceAuthContext,
} from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type MessageDraftWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-draft.workspace-entity';
import { type MessageThreadWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-thread.workspace-entity';

@Injectable()
export class MessageDraftAccessService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
  ) {}

  requireUserAuthContext(
    authContext: WorkspaceAuthContext,
  ): UserWorkspaceAuthContext {
    if (!isUserAuthContext(authContext)) {
      throw new CommonQueryRunnerException(
        'A user authentication context is required to access message drafts',
        CommonQueryRunnerExceptionCode.INVALID_AUTH_CONTEXT,
        {
          userFriendlyMessage: msg`You must be authenticated to manage email drafts.`,
        },
      );
    }

    return authContext;
  }

  addOwnerFilter(
    filter: ObjectRecordFilter | undefined,
    workspaceMemberId: string,
  ): ObjectRecordFilter {
    const ownerFilter = { authorId: { eq: workspaceMemberId } };

    return filter ? { and: [filter, ownerFilter] } : ownerFilter;
  }

  forceAuthor(
    data: Partial<MessageDraftWorkspaceEntity>,
    workspaceMemberId: string,
  ): Partial<MessageDraftWorkspaceEntity> {
    return {
      ...data,
      ...(data.subject !== undefined
        ? { subject: typeof data.subject === 'string' ? data.subject : '' }
        : {}),
      ...(data.body !== undefined
        ? { body: typeof data.body === 'string' ? data.body : '' }
        : {}),
      ...(data.to !== undefined
        ? { to: typeof data.to === 'string' ? data.to : '' }
        : {}),
      ...(data.cc !== undefined
        ? { cc: typeof data.cc === 'string' ? data.cc : '' }
        : {}),
      ...(data.bcc !== undefined
        ? { bcc: typeof data.bcc === 'string' ? data.bcc : '' }
        : {}),
      authorId: workspaceMemberId,
      lastEditedAt: new Date(),
    };
  }

  requireConnectedAccountIds(
    connectedAccountIds: (string | undefined)[],
  ): string[] {
    const requiredConnectedAccountIds = connectedAccountIds.filter(isDefined);

    if (
      requiredConnectedAccountIds.length === 0 ||
      requiredConnectedAccountIds.length !== connectedAccountIds.length
    ) {
      throw new CommonQueryRunnerException(
        'A connected account is required for a message draft',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        { userFriendlyMessage: msg`Select one of your connected accounts.` },
      );
    }

    return requiredConnectedAccountIds;
  }

  async assertConnectedAccountsOwnedByUser({
    connectedAccountIds,
    authContext,
  }: {
    connectedAccountIds: string[];
    authContext: UserWorkspaceAuthContext;
  }): Promise<void> {
    const uniqueConnectedAccountIds = [...new Set(connectedAccountIds)];

    if (uniqueConnectedAccountIds.length === 0) {
      throw new CommonQueryRunnerException(
        'A connected account is required for a message draft',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        { userFriendlyMessage: msg`Select one of your connected accounts.` },
      );
    }

    const ownedConnectedAccountCount =
      await this.connectedAccountRepository.countBy({
        id: In(uniqueConnectedAccountIds),
        userWorkspaceId: authContext.userWorkspaceId,
        workspaceId: authContext.workspace.id,
        archivedAt: IsNull(),
      });

    if (ownedConnectedAccountCount !== uniqueConnectedAccountIds.length) {
      throw new CommonQueryRunnerException(
        'One or more connected accounts do not belong to the authenticated user',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        { userFriendlyMessage: msg`Select one of your connected accounts.` },
      );
    }
  }

  async assertDraftIdsOwnedByUser({
    draftIds,
    authContext,
  }: {
    draftIds: string[];
    authContext: UserWorkspaceAuthContext;
  }): Promise<void> {
    const uniqueDraftIds = [...new Set(draftIds)];

    const ownedDrafts =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<MessageDraftWorkspaceEntity>(
              authContext.workspace.id,
              'messageDraft',
              { shouldBypassPermissionChecks: true },
            );

          return repository.find({
            select: ['id'],
            where: {
              id: In(uniqueDraftIds),
              authorId: authContext.workspaceMemberId,
            },
            withDeleted: true,
          });
        },
        authContext,
        { lite: true },
      );

    if (ownedDrafts.length !== uniqueDraftIds.length) {
      throw new CommonQueryRunnerException(
        'One or more message drafts were not found',
        CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
        { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
      );
    }
  }

  async assertMessageThreadsOwnedByUser({
    messageThreadIds,
    authContext,
  }: {
    messageThreadIds: string[];
    authContext: UserWorkspaceAuthContext;
  }): Promise<void> {
    const uniqueMessageThreadIds = [...new Set(messageThreadIds)];

    if (uniqueMessageThreadIds.length === 0) {
      return;
    }

    const ownedConnectedAccounts = await this.connectedAccountRepository.find({
      where: {
        userWorkspaceId: authContext.userWorkspaceId,
        workspaceId: authContext.workspace.id,
        archivedAt: IsNull(),
      },
      select: { id: true },
    });
    const ownedMessageChannels =
      ownedConnectedAccounts.length === 0
        ? []
        : await this.messageChannelRepository.find({
            where: {
              connectedAccountId: In(
                ownedConnectedAccounts.map(({ id }) => id),
              ),
              workspaceId: authContext.workspace.id,
              type: MessageChannelType.EMAIL,
            },
            select: { id: true },
          });

    if (ownedMessageChannels.length === 0) {
      return this.throwMessageThreadsNotFound();
    }

    const ownedMessageThreadIds =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<MessageThreadWorkspaceEntity>(
              authContext.workspace.id,
              'messageThread',
              { shouldBypassPermissionChecks: true },
            );

          return repository
            .createQueryBuilder('messageThread')
            .select('messageThread.id', 'id')
            .innerJoin('messageThread.messages', 'message')
            .innerJoin(
              'message.messageChannelMessageAssociations',
              'association',
            )
            .where('messageThread.id IN (:...messageThreadIds)', {
              messageThreadIds: uniqueMessageThreadIds,
            })
            .andWhere('association.messageChannelId IN (:...channelIds)', {
              channelIds: ownedMessageChannels.map(({ id }) => id),
            })
            .distinct(true)
            .getRawMany<{ id: string }>();
        },
        authContext,
        { lite: true },
      );

    if (ownedMessageThreadIds.length !== uniqueMessageThreadIds.length) {
      return this.throwMessageThreadsNotFound();
    }
  }

  private throwMessageThreadsNotFound(): never {
    throw new CommonQueryRunnerException(
      'One or more message threads were not found',
      CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
      { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
    );
  }

  throwUnsupportedOperation(operationName: string): never {
    throw new CommonQueryRunnerException(
      `${operationName} is not supported for message drafts`,
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`This operation is not available for email drafts.`,
      },
    );
  }
}
