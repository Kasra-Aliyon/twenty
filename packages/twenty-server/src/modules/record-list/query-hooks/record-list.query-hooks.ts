import { Injectable } from '@nestjs/common';

import { assertIsDefinedOrThrow } from 'twenty-shared/utils';

import {
  type WorkspacePostQueryHookInstance,
  type WorkspacePreQueryHookInstance,
} from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { WorkspaceQueryHookType } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/types/workspace-query-hook.type';
import {
  type CreateManyResolverArgs,
  type CreateOneResolverArgs,
  type DeleteManyResolverArgs,
  type DeleteOneResolverArgs,
  type DestroyManyResolverArgs,
  type UpdateManyResolverArgs,
  type UpdateOneResolverArgs,
} from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { WorkspaceNotFoundDefaultError } from 'src/engine/core-modules/workspace/workspace.exception';
import { RecordListValidationService } from 'src/modules/record-list/services/record-list-validation.service';
import { RecordListViewService } from 'src/modules/record-list/services/record-list-view.service';
import { type RecordListFolderWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-folder.workspace-entity';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';

@Injectable()
@WorkspaceQueryHook('recordListFolder.createOne')
export class RecordListFolderCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<RecordListFolderWorkspaceEntity>,
  ): Promise<CreateOneResolverArgs<RecordListFolderWorkspaceEntity>> {
    this.validationService.normalizeAndValidateName(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.createMany')
export class RecordListFolderCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateManyResolverArgs<RecordListFolderWorkspaceEntity>,
  ): Promise<CreateManyResolverArgs<RecordListFolderWorkspaceEntity>> {
    payload.data.forEach((data) =>
      this.validationService.normalizeAndValidateName(data),
    );

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.updateOne')
export class RecordListFolderUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs<RecordListFolderWorkspaceEntity>,
  ): Promise<UpdateOneResolverArgs<RecordListFolderWorkspaceEntity>> {
    this.validationService.normalizeAndValidateName(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.updateMany')
export class RecordListFolderUpdateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateManyResolverArgs<RecordListFolderWorkspaceEntity>,
  ): Promise<UpdateManyResolverArgs<RecordListFolderWorkspaceEntity>> {
    this.validationService.normalizeAndValidateName(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.deleteOne')
export class RecordListFolderDeleteOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DeleteOneResolverArgs,
  ): Promise<DeleteOneResolverArgs> {
    assertIsDefinedOrThrow(
      authContext.workspace,
      WorkspaceNotFoundDefaultError,
    );
    await this.validationService.validateFolderIsEmpty({
      folderId: payload.id,
      workspaceId: authContext.workspace.id,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.destroyOne')
export class RecordListFolderDestroyOnePreQueryHook extends RecordListFolderDeleteOnePreQueryHook {
  constructor(validationService: RecordListValidationService) {
    super(validationService);
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.deleteMany')
export class RecordListFolderDeleteManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DeleteManyResolverArgs<{ id: { in: string[] } }>,
  ): Promise<DeleteManyResolverArgs<{ id: { in: string[] } }>> {
    assertIsDefinedOrThrow(
      authContext.workspace,
      WorkspaceNotFoundDefaultError,
    );
    await this.validationService.validateFoldersAreEmpty({
      folderIds: payload.filter.id.in,
      workspaceId: authContext.workspace.id,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListFolder.destroyMany')
export class RecordListFolderDestroyManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DestroyManyResolverArgs<{ id: { in: string[] } }>,
  ): Promise<DestroyManyResolverArgs<{ id: { in: string[] } }>> {
    assertIsDefinedOrThrow(
      authContext.workspace,
      WorkspaceNotFoundDefaultError,
    );
    await this.validationService.validateFoldersAreEmpty({
      folderIds: payload.filter.id.in,
      workspaceId: authContext.workspace.id,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordList.createOne')
export class RecordListCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<RecordListWorkspaceEntity>,
  ): Promise<CreateOneResolverArgs<RecordListWorkspaceEntity>> {
    this.validationService.normalizeAndValidateName(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordList.createMany')
export class RecordListCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateManyResolverArgs<RecordListWorkspaceEntity>,
  ): Promise<CreateManyResolverArgs<RecordListWorkspaceEntity>> {
    payload.data.forEach((data) =>
      this.validationService.normalizeAndValidateName(data),
    );

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordList.updateOne')
export class RecordListUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs<RecordListWorkspaceEntity>,
  ): Promise<UpdateOneResolverArgs<RecordListWorkspaceEntity>> {
    this.validationService.normalizeAndValidateName(payload.data);
    this.validationService.validateListTypeIsImmutable(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordList.updateMany')
export class RecordListUpdateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateManyResolverArgs<RecordListWorkspaceEntity>,
  ): Promise<UpdateManyResolverArgs<RecordListWorkspaceEntity>> {
    this.validationService.normalizeAndValidateName(payload.data);
    this.validationService.validateListTypeIsImmutable(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'recordList.createOne',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class RecordListCreateOnePostQueryHook implements WorkspacePostQueryHookInstance {
  constructor(private readonly recordListViewService: RecordListViewService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: RecordListWorkspaceEntity[],
  ): Promise<void> {
    const results = await Promise.allSettled(
      payload.map((list) =>
        this.recordListViewService.createViewForList({ list, authContext }),
      ),
    );
    const failedResult = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (failedResult) {
      throw failedResult.reason;
    }
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'recordList.createMany',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class RecordListCreateManyPostQueryHook extends RecordListCreateOnePostQueryHook {
  constructor(recordListViewService: RecordListViewService) {
    super(recordListViewService);
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'recordList.deleteOne',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class RecordListDeleteOnePostQueryHook implements WorkspacePostQueryHookInstance {
  constructor(private readonly recordListViewService: RecordListViewService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: RecordListWorkspaceEntity[],
  ): Promise<void> {
    await this.recordListViewService.deleteViewsAndMembersForLists({
      lists: payload,
      authContext,
      destroy: false,
    });
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'recordList.deleteMany',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class RecordListDeleteManyPostQueryHook extends RecordListDeleteOnePostQueryHook {
  constructor(recordListViewService: RecordListViewService) {
    super(recordListViewService);
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'recordList.destroyOne',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class RecordListDestroyOnePostQueryHook implements WorkspacePostQueryHookInstance {
  constructor(private readonly recordListViewService: RecordListViewService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: RecordListWorkspaceEntity[],
  ): Promise<void> {
    await this.recordListViewService.deleteViewsAndMembersForLists({
      lists: payload,
      authContext,
      destroy: true,
    });
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'recordList.destroyMany',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class RecordListDestroyManyPostQueryHook extends RecordListDestroyOnePostQueryHook {
  constructor(recordListViewService: RecordListViewService) {
    super(recordListViewService);
  }
}

@Injectable()
@WorkspaceQueryHook('recordListMember.createOne')
export class RecordListMemberCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<RecordListMemberWorkspaceEntity>,
  ): Promise<CreateOneResolverArgs<RecordListMemberWorkspaceEntity>> {
    assertIsDefinedOrThrow(
      authContext.workspace,
      WorkspaceNotFoundDefaultError,
    );
    await this.validationService.validateMembersForCreate({
      data: [payload.data],
      workspaceId: authContext.workspace.id,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListMember.createMany')
export class RecordListMemberCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateManyResolverArgs<RecordListMemberWorkspaceEntity>,
  ): Promise<CreateManyResolverArgs<RecordListMemberWorkspaceEntity>> {
    assertIsDefinedOrThrow(
      authContext.workspace,
      WorkspaceNotFoundDefaultError,
    );
    await this.validationService.validateMembersForCreate({
      data: payload.data,
      workspaceId: authContext.workspace.id,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListMember.updateOne')
export class RecordListMemberUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs<RecordListMemberWorkspaceEntity>,
  ): Promise<UpdateOneResolverArgs<RecordListMemberWorkspaceEntity>> {
    this.validationService.validateMemberIsImmutable(payload.data);

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('recordListMember.updateMany')
export class RecordListMemberUpdateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly validationService: RecordListValidationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateManyResolverArgs<RecordListMemberWorkspaceEntity>,
  ): Promise<UpdateManyResolverArgs<RecordListMemberWorkspaceEntity>> {
    this.validationService.validateMemberIsImmutable(payload.data);

    return payload;
  }
}
