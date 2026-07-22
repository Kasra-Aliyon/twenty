import { Injectable } from '@nestjs/common';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
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
import {
  type LinkedinOwnedRecordData,
  LinkedinRecordAccessService,
} from 'src/modules/linkedin/query-hooks/linkedin-record-access.service';

const isThreadChildObject = (objectName: string): boolean =>
  objectName === 'linkedinMessage' ||
  objectName === 'linkedinThreadParticipant';

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

    await validateUpdatedThreadRelation({
      accessService: this.accessService,
      authContext: userAuthContext,
      objectName,
      data: payload.data,
    });

    return {
      ...payload,
      filter: this.accessService.addOwnerFilter(
        payload.filter,
        userAuthContext.workspaceMemberId,
      ),
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
