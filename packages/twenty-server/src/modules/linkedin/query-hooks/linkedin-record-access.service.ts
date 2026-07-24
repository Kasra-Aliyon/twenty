import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { isNonEmptyString } from '@sniptt/guards';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { type ObjectRecord } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

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
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

export const LINKEDIN_OWNED_OBJECT_NAMES = [
  'linkedinMessageThread',
  'linkedinMessage',
  'linkedinThreadParticipant',
  'linkedinConnection',
  'linkedinInvitation',
  'linkedinAction',
] as const;

export type LinkedinOwnedObjectName =
  (typeof LINKEDIN_OWNED_OBJECT_NAMES)[number];

const LINKEDIN_OWNED_OBJECT_UNIVERSAL_IDENTIFIERS = {
  linkedinMessageThread:
    STANDARD_OBJECTS.linkedinMessageThread.universalIdentifier,
  linkedinMessage: STANDARD_OBJECTS.linkedinMessage.universalIdentifier,
  linkedinThreadParticipant:
    STANDARD_OBJECTS.linkedinThreadParticipant.universalIdentifier,
  linkedinConnection: STANDARD_OBJECTS.linkedinConnection.universalIdentifier,
  linkedinInvitation: STANDARD_OBJECTS.linkedinInvitation.universalIdentifier,
  linkedinAction: STANDARD_OBJECTS.linkedinAction.universalIdentifier,
} as const satisfies Record<LinkedinOwnedObjectName, string>;

export type LinkedinOwnedRecordData = Partial<ObjectRecord> & {
  id?: string;
  ownerWorkspaceMemberId?: string | null;
  threadId?: string | null;
};

type LinkedinOwnedWorkspaceEntity = ObjectRecord & {
  ownerWorkspaceMemberId: string | null;
};

@Injectable()
export class LinkedinRecordAccessService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  isOwnedObjectName(objectName: string): objectName is LinkedinOwnedObjectName {
    return LINKEDIN_OWNED_OBJECT_NAMES.some(
      (ownedObjectName) => ownedObjectName === objectName,
    );
  }

  async isOwnedObject(
    objectName: string,
    workspaceId: string,
  ): Promise<boolean> {
    if (!this.isOwnedObjectName(objectName)) {
      return false;
    }

    const { flatObjectMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
      ]);
    const standardObjectMetadata =
      flatObjectMetadataMaps.byUniversalIdentifier[
        LINKEDIN_OWNED_OBJECT_UNIVERSAL_IDENTIFIERS[objectName]
      ];

    return (
      standardObjectMetadata?.isActive === true &&
      standardObjectMetadata.nameSingular === objectName
    );
  }

  requireUserAuthContext(
    authContext: WorkspaceAuthContext,
  ): UserWorkspaceAuthContext {
    if (!isUserAuthContext(authContext)) {
      throw new CommonQueryRunnerException(
        'A user authentication context is required to access LinkedIn records',
        CommonQueryRunnerExceptionCode.INVALID_AUTH_CONTEXT,
        {
          userFriendlyMessage: msg`You must be authenticated to manage LinkedIn records.`,
        },
      );
    }

    return authContext;
  }

  addOwnerFilter(
    filter: ObjectRecordFilter | undefined,
    workspaceMemberId: string,
  ): ObjectRecordFilter {
    const ownerFilter = {
      ownerWorkspaceMemberId: { eq: workspaceMemberId },
    };

    return filter ? { and: [filter, ownerFilter] } : ownerFilter;
  }

  forceOwner<TData extends LinkedinOwnedRecordData>(
    data: TData,
    workspaceMemberId: string,
  ): TData {
    return {
      ...data,
      ownerWorkspaceMemberId: workspaceMemberId,
    };
  }

  async assertRecordIdsOwnedByUser({
    objectName,
    recordIds,
    authContext,
  }: {
    objectName: LinkedinOwnedObjectName;
    recordIds: string[];
    authContext: UserWorkspaceAuthContext;
  }): Promise<void> {
    const uniqueRecordIds = [...new Set(recordIds)];

    if (uniqueRecordIds.length === 0) {
      return;
    }

    const ownedRecords =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<LinkedinOwnedWorkspaceEntity>(
              authContext.workspace.id,
              objectName,
              { shouldBypassPermissionChecks: true },
            );

          return repository.find({
            select: ['id'],
            where: {
              id: In(uniqueRecordIds),
              ownerWorkspaceMemberId: authContext.workspaceMemberId,
            },
            withDeleted: true,
          });
        },
        authContext,
        { lite: true },
      );

    if (ownedRecords.length !== uniqueRecordIds.length) {
      this.throwRecordsNotFound();
    }
  }

  async assertUpsertRecordIdsDoNotBelongToAnotherUser({
    objectName,
    recordIds,
    authContext,
  }: {
    objectName: LinkedinOwnedObjectName;
    recordIds: Array<string | undefined>;
    authContext: UserWorkspaceAuthContext;
  }): Promise<void> {
    const uniqueRecordIds = [...new Set(recordIds.filter(isNonEmptyString))];

    if (uniqueRecordIds.length === 0) {
      return;
    }

    const existingRecords =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<LinkedinOwnedWorkspaceEntity>(
              authContext.workspace.id,
              objectName,
              { shouldBypassPermissionChecks: true },
            );

          return repository.find({
            select: ['id', 'ownerWorkspaceMemberId'],
            where: { id: In(uniqueRecordIds) },
            withDeleted: true,
          });
        },
        authContext,
        { lite: true },
      );

    if (
      existingRecords.some(
        ({ ownerWorkspaceMemberId }) =>
          ownerWorkspaceMemberId !== authContext.workspaceMemberId,
      )
    ) {
      this.throwRecordsNotFound();
    }
  }

  async assertThreadIdsOwnedByUser({
    threadIds,
    authContext,
  }: {
    threadIds: Array<string | null | undefined>;
    authContext: UserWorkspaceAuthContext;
  }): Promise<void> {
    const requiredThreadIds = threadIds.filter(isDefined);

    if (
      requiredThreadIds.length !== threadIds.length ||
      requiredThreadIds.some((threadId) => !isNonEmptyString(threadId))
    ) {
      this.throwRecordsNotFound();
    }

    await this.assertRecordIdsOwnedByUser({
      objectName: 'linkedinMessageThread',
      recordIds: requiredThreadIds,
      authContext,
    });
  }

  throwUnsupportedOperation(operationName: string): never {
    throw new CommonQueryRunnerException(
      `${operationName} is not supported for LinkedIn records`,
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`This operation is not available for LinkedIn records.`,
      },
    );
  }

  private throwRecordsNotFound(): never {
    throw new CommonQueryRunnerException(
      'One or more LinkedIn records were not found',
      CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
      { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
    );
  }
}
