import { Injectable } from '@nestjs/common';

import { LINKEDIN_ACTION_STATUSES } from 'twenty-shared/types';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { markWorkspaceQueryForTransaction } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import {
  type CreateManyResolverArgs,
  type CreateOneResolverArgs,
  type DeleteManyResolverArgs,
  type DeleteOneResolverArgs,
  type DestroyManyResolverArgs,
  type DestroyOneResolverArgs,
  type FindDuplicatesResolverArgs,
  type FindManyResolverArgs,
  type FindOneResolverArgs,
  type GroupByResolverArgs,
  type MergeManyResolverArgs,
  type RestoreManyResolverArgs,
  type RestoreOneResolverArgs,
  type UpdateManyResolverArgs,
  type UpdateOneResolverArgs,
} from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import {
  type LinkedinOwnedRecordData,
  LinkedinRecordAccessService,
} from 'src/modules/linkedin/query-hooks/linkedin-record-access.service';

const isThreadChildObject = (objectName: string): boolean =>
  objectName === 'linkedinMessage' ||
  objectName === 'linkedinThreadParticipant';

const SEQUENCE_LINKEDIN_ACTION_RELATION_FIELDS = [
  'sequenceEnrollmentId',
  'sequenceStepId',
] as const;

const SEQUENCE_LINKEDIN_ACTION_ENGINE_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy',
  'type',
  'status',
  'scheduledAt',
  'claimedAt',
  'claimedBy',
  'executedAt',
  'attemptCount',
  'errorMessage',
  'ownerWorkspaceMemberId',
  'linkedinUrl',
  'noteText',
  'connectionState',
  'person',
  'personId',
  'position',
  'searchVector',
  ...SEQUENCE_LINKEDIN_ACTION_RELATION_FIELDS,
] as const;

const CAP_COUNTED_LINKEDIN_ACTION_STATUSES = [
  LINKEDIN_ACTION_STATUSES.SCHEDULED,
  LINKEDIN_ACTION_STATUSES.CLAIMED,
  LINKEDIN_ACTION_STATUSES.COMPLETED,
  LINKEDIN_ACTION_STATUSES.SKIPPED,
  LINKEDIN_ACTION_STATUSES.FAILED,
] as const;

const hasOwnField = (
  data: LinkedinOwnedRecordData,
  fieldName: string,
): boolean => Object.prototype.hasOwnProperty.call(data, fieldName);

const hasSequenceActionEngineMutation = ({
  data,
  objectName,
}: {
  data: LinkedinOwnedRecordData;
  objectName: string;
}): boolean =>
  objectName === 'linkedinAction' &&
  SEQUENCE_LINKEDIN_ACTION_ENGINE_FIELDS.some((fieldName) =>
    hasOwnField(data, fieldName),
  );

const assertActionCreationIsNotSequenceLinked = ({
  accessService,
  data,
  objectName,
}: {
  accessService: LinkedinRecordAccessService;
  data: LinkedinOwnedRecordData;
  objectName: string;
}): void => {
  if (objectName !== 'linkedinAction') {
    return;
  }

  if (
    SEQUENCE_LINKEDIN_ACTION_RELATION_FIELDS.some(
      (fieldName) => data[fieldName] !== undefined && data[fieldName] !== null,
    )
  ) {
    accessService.throwUnsupportedOperation(
      'Creating a sequence-linked LinkedIn action directly',
    );
  }
};

const assertActionSequenceRelationsAreNotUpdated = ({
  accessService,
  data,
  objectName,
}: {
  accessService: LinkedinRecordAccessService;
  data: LinkedinOwnedRecordData;
  objectName: string;
}): void => {
  if (
    objectName === 'linkedinAction' &&
    SEQUENCE_LINKEDIN_ACTION_RELATION_FIELDS.some((fieldName) =>
      hasOwnField(data, fieldName),
    )
  ) {
    accessService.throwUnsupportedOperation(
      'Changing sequence LinkedIn action relations directly',
    );
  }
};

const addSequenceActionDeletionSafetyFilter = ({
  filter,
  objectName,
}: {
  filter: ObjectRecordFilter;
  objectName: string;
}): ObjectRecordFilter =>
  objectName === 'linkedinAction'
    ? {
        and: [
          filter,
          {
            not: {
              or: [
                { sequenceEnrollmentId: { is: 'NOT_NULL' } },
                { sequenceStepId: { is: 'NOT_NULL' } },
                { status: { in: CAP_COUNTED_LINKEDIN_ACTION_STATUSES } },
              ],
            },
          },
        ],
      }
    : filter;

const addSequenceActionUpdateSafetyFilter = ({
  data,
  filter,
  objectName,
}: {
  data: LinkedinOwnedRecordData;
  filter: ObjectRecordFilter;
  objectName: string;
}): ObjectRecordFilter =>
  hasSequenceActionEngineMutation({ data, objectName })
    ? {
        and: [
          filter,
          {
            not: {
              or: [
                { sequenceEnrollmentId: { is: 'NOT_NULL' } },
                { sequenceStepId: { is: 'NOT_NULL' } },
                { status: { in: CAP_COUNTED_LINKEDIN_ACTION_STATUSES } },
              ],
            },
          },
        ],
      }
    : filter;

const assertActionClaimUsesClaimMutation = ({
  accessService,
  objectName,
  data,
}: {
  accessService: LinkedinRecordAccessService;
  objectName: string;
  data: LinkedinOwnedRecordData;
}): void => {
  if (
    objectName === 'linkedinAction' &&
    (data as { status?: string }).status === LINKEDIN_ACTION_STATUSES.CLAIMED
  ) {
    accessService.throwUnsupportedOperation(
      'Direct LinkedIn action claiming; use claimSequenceLinkedinAction',
    );
  }
};

const validateCreatedThreadRelations = async ({
  accessService,
  authContext,
  objectName,
  data,
}: {
  accessService: LinkedinRecordAccessService;
  authContext: ReturnType<
    LinkedinRecordAccessService['requireUserAuthContext']
  >;
  objectName: string;
  data: LinkedinOwnedRecordData[];
}): Promise<void> => {
  if (!isThreadChildObject(objectName)) {
    return;
  }

  await accessService.assertThreadIdsOwnedByUser({
    threadIds: data.map(({ threadId }) => threadId),
    authContext,
  });
};

const validateUpdatedThreadRelation = async ({
  accessService,
  authContext,
  objectName,
  data,
}: {
  accessService: LinkedinRecordAccessService;
  authContext: ReturnType<
    LinkedinRecordAccessService['requireUserAuthContext']
  >;
  objectName: string;
  data: LinkedinOwnedRecordData;
}): Promise<void> => {
  if (!isThreadChildObject(objectName) || data.threadId === undefined) {
    return;
  }

  await accessService.assertThreadIdsOwnedByUser({
    threadIds: [data.threadId],
    authContext,
  });
};

@Injectable()
@WorkspaceQueryHook('*.findMany')
export class LinkedinRecordFindManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: FindManyResolverArgs,
  ): Promise<FindManyResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    return {
      ...payload,
      filter: this.accessService.addOwnerFilter(
        payload.filter,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.findOne')
export class LinkedinRecordFindOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: FindOneResolverArgs,
  ): Promise<FindOneResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    return {
      ...payload,
      filter: this.accessService.addOwnerFilter(
        payload.filter,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.groupBy')
export class LinkedinRecordGroupByPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: GroupByResolverArgs,
  ): Promise<GroupByResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    return {
      ...payload,
      filter: this.accessService.addOwnerFilter(
        payload.filter,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.findDuplicates')
export class LinkedinRecordFindDuplicatesPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: FindDuplicatesResolverArgs,
  ): Promise<FindDuplicatesResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    this.accessService.requireUserAuthContext(authContext);

    return this.accessService.throwUnsupportedOperation('findDuplicates');
  }
}

@Injectable()
@WorkspaceQueryHook('*.createOne')
export class LinkedinRecordCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateOneResolverArgs<LinkedinOwnedRecordData>,
  ): Promise<CreateOneResolverArgs<LinkedinOwnedRecordData>> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    assertActionCreationIsNotSequenceLinked({
      accessService: this.accessService,
      objectName,
      data: payload.data,
    });
    assertActionClaimUsesClaimMutation({
      accessService: this.accessService,
      objectName,
      data: payload.data,
    });

    if (objectName === 'linkedinAction' && payload.upsert === true) {
      return this.accessService.throwUnsupportedOperation(
        'Upserting LinkedIn actions',
      );
    }

    await Promise.all([
      validateCreatedThreadRelations({
        accessService: this.accessService,
        authContext: userAuthContext,
        objectName,
        data: [payload.data],
      }),
      payload.upsert === true
        ? this.accessService.assertUpsertRecordIdsDoNotBelongToAnotherUser({
            objectName,
            recordIds: [payload.data.id],
            authContext: userAuthContext,
          })
        : Promise.resolve(),
    ]);

    return {
      ...payload,
      data: this.accessService.forceOwner(
        payload.data,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.createMany')
export class LinkedinRecordCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateManyResolverArgs<LinkedinOwnedRecordData>,
  ): Promise<CreateManyResolverArgs<LinkedinOwnedRecordData>> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    for (const data of payload.data) {
      assertActionCreationIsNotSequenceLinked({
        accessService: this.accessService,
        objectName,
        data,
      });
      assertActionClaimUsesClaimMutation({
        accessService: this.accessService,
        objectName,
        data,
      });
    }

    if (objectName === 'linkedinAction' && payload.upsert === true) {
      return this.accessService.throwUnsupportedOperation(
        'Upserting LinkedIn actions',
      );
    }

    await Promise.all([
      validateCreatedThreadRelations({
        accessService: this.accessService,
        authContext: userAuthContext,
        objectName,
        data: payload.data,
      }),
      payload.upsert === true
        ? this.accessService.assertUpsertRecordIdsDoNotBelongToAnotherUser({
            objectName,
            recordIds: payload.data.map(({ id }) => id),
            authContext: userAuthContext,
          })
        : Promise.resolve(),
    ]);

    return {
      ...payload,
      data: payload.data.map((data) =>
        this.accessService.forceOwner(data, userAuthContext.workspaceMemberId),
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.updateOne')
export class LinkedinRecordUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs<LinkedinOwnedRecordData>,
  ): Promise<UpdateOneResolverArgs<LinkedinOwnedRecordData>> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    assertActionClaimUsesClaimMutation({
      accessService: this.accessService,
      objectName,
      data: payload.data,
    });
    assertActionSequenceRelationsAreNotUpdated({
      accessService: this.accessService,
      objectName,
      data: payload.data,
    });

    await Promise.all([
      this.accessService.assertRecordIdsOwnedByUser({
        objectName,
        recordIds: [payload.id],
        authContext: userAuthContext,
      }),
      validateUpdatedThreadRelation({
        accessService: this.accessService,
        authContext: userAuthContext,
        objectName,
        data: payload.data,
      }),
      hasSequenceActionEngineMutation({
        objectName,
        data: payload.data,
      })
        ? this.accessService.assertLinkedinActionIdsAreNotExecutionManaged({
            actionIds: [payload.id],
            authContext: userAuthContext,
            operationName:
              'Changing sequence LinkedIn action execution fields directly',
          })
        : Promise.resolve(),
    ]);

    const result = {
      ...payload,
      data: this.accessService.forceOwner(
        payload.data,
        userAuthContext.workspaceMemberId,
      ),
    };

    return hasSequenceActionEngineMutation({
      objectName,
      data: payload.data,
    })
      ? markWorkspaceQueryForTransaction(result)
      : result;
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs<LinkedinOwnedRecordData>,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<UpdateOneResolverArgs<LinkedinOwnedRecordData>> {
    if (objectName !== 'linkedinAction') {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.lockLinkedinActionIdsAndAssertNotExecutionManaged({
      actionIds: [payload.id],
      authContext: userAuthContext,
      operationName:
        'Changing sequence LinkedIn action execution fields directly',
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.updateMany')
export class LinkedinRecordUpdateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateManyResolverArgs<
      LinkedinOwnedRecordData,
      ObjectRecordFilter
    >,
  ): Promise<
    UpdateManyResolverArgs<LinkedinOwnedRecordData, ObjectRecordFilter>
  > {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    assertActionClaimUsesClaimMutation({
      accessService: this.accessService,
      objectName,
      data: payload.data,
    });
    assertActionSequenceRelationsAreNotUpdated({
      accessService: this.accessService,
      objectName,
      data: payload.data,
    });

    await validateUpdatedThreadRelation({
      accessService: this.accessService,
      authContext: userAuthContext,
      objectName,
      data: payload.data,
    });

    const ownerScopedFilter = this.accessService.addOwnerFilter(
      payload.filter,
      userAuthContext.workspaceMemberId,
    );

    return {
      ...payload,
      filter: addSequenceActionUpdateSafetyFilter({
        data: payload.data,
        filter: ownerScopedFilter,
        objectName,
      }),
      data: this.accessService.forceOwner(
        payload.data,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.deleteOne')
export class LinkedinRecordDeleteOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteOneResolverArgs,
  ): Promise<DeleteOneResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.assertRecordIdsOwnedByUser({
      objectName,
      recordIds: [payload.id],
      authContext: userAuthContext,
    });

    if (objectName === 'linkedinAction') {
      await this.accessService.assertLinkedinActionsCanBeDeleted({
        actionIds: [payload.id],
        authContext: userAuthContext,
      });
    }

    return objectName === 'linkedinAction'
      ? markWorkspaceQueryForTransaction(payload)
      : payload;
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<DeleteOneResolverArgs> {
    if (objectName !== 'linkedinAction') {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.lockLinkedinActionIdsAndAssertNotExecutionManaged({
      actionIds: [payload.id],
      authContext: userAuthContext,
      operationName: 'Deleting LinkedIn action execution or quota history',
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.deleteMany')
export class LinkedinRecordDeleteManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteManyResolverArgs<ObjectRecordFilter>,
  ): Promise<DeleteManyResolverArgs<ObjectRecordFilter>> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    const ownerScopedFilter = this.accessService.addOwnerFilter(
      payload.filter,
      userAuthContext.workspaceMemberId,
    );

    return {
      ...payload,
      filter: addSequenceActionDeletionSafetyFilter({
        filter: ownerScopedFilter,
        objectName,
      }),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.destroyOne')
export class LinkedinRecordDestroyOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
  ): Promise<DestroyOneResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.assertRecordIdsOwnedByUser({
      objectName,
      recordIds: [payload.id],
      authContext: userAuthContext,
    });

    if (objectName === 'linkedinAction') {
      await this.accessService.assertLinkedinActionsCanBeDeleted({
        actionIds: [payload.id],
        authContext: userAuthContext,
      });
    }

    return objectName === 'linkedinAction'
      ? markWorkspaceQueryForTransaction(payload)
      : payload;
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<DestroyOneResolverArgs> {
    if (objectName !== 'linkedinAction') {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.lockLinkedinActionIdsAndAssertNotExecutionManaged({
      actionIds: [payload.id],
      authContext: userAuthContext,
      operationName: 'Deleting LinkedIn action execution or quota history',
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.destroyMany')
export class LinkedinRecordDestroyManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyManyResolverArgs<ObjectRecordFilter>,
  ): Promise<DestroyManyResolverArgs<ObjectRecordFilter>> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    const ownerScopedFilter = this.accessService.addOwnerFilter(
      payload.filter,
      userAuthContext.workspaceMemberId,
    );

    return {
      ...payload,
      filter: addSequenceActionDeletionSafetyFilter({
        filter: ownerScopedFilter,
        objectName,
      }),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.restoreOne')
export class LinkedinRecordRestoreOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: RestoreOneResolverArgs,
  ): Promise<RestoreOneResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.assertRecordIdsOwnedByUser({
      objectName,
      recordIds: [payload.id],
      authContext: userAuthContext,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.restoreMany')
export class LinkedinRecordRestoreManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: RestoreManyResolverArgs<ObjectRecordFilter>,
  ): Promise<RestoreManyResolverArgs<ObjectRecordFilter>> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    return {
      ...payload,
      filter: this.accessService.addOwnerFilter(
        payload.filter,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.mergeMany')
export class LinkedinRecordMergeManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: LinkedinRecordAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: MergeManyResolverArgs,
  ): Promise<MergeManyResolverArgs> {
    if (
      !this.accessService.isOwnedObjectName(objectName) ||
      !(await this.accessService.isOwnedObject(
        objectName,
        authContext.workspace.id,
      ))
    ) {
      return payload;
    }

    this.accessService.requireUserAuthContext(authContext);

    return this.accessService.throwUnsupportedOperation('mergeMany');
  }
}
