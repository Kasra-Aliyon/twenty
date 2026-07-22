import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

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
import { MessageDraftAccessService } from 'src/modules/messaging/common/query-hooks/message-draft/message-draft-access.service';
import { type MessageDraftWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-draft.workspace-entity';

type MessageDraftData = Partial<MessageDraftWorkspaceEntity>;

const validateConnectedAccountChange = async ({
  accessService,
  authContext,
  connectedAccountId,
}: {
  accessService: MessageDraftAccessService;
  authContext: ReturnType<MessageDraftAccessService['requireUserAuthContext']>;
  connectedAccountId: string | undefined;
}): Promise<void> => {
  if (!isDefined(connectedAccountId)) {
    return;
  }

  await accessService.assertConnectedAccountsOwnedByUser({
    connectedAccountIds: [connectedAccountId],
    authContext,
  });
};

const validateMessageThreadChange = async ({
  accessService,
  authContext,
  messageThreadId,
}: {
  accessService: MessageDraftAccessService;
  authContext: ReturnType<MessageDraftAccessService['requireUserAuthContext']>;
  messageThreadId: string | null | undefined;
}): Promise<void> => {
  if (!isDefined(messageThreadId)) {
    return;
  }

  await accessService.assertMessageThreadsOwnedByUser({
    messageThreadIds: [messageThreadId],
    authContext,
  });
};

@Injectable()
@WorkspaceQueryHook('messageDraft.findMany')
export class MessageDraftFindManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: FindManyResolverArgs,
  ): Promise<FindManyResolverArgs> {
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
@WorkspaceQueryHook('messageDraft.findOne')
export class MessageDraftFindOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: FindOneResolverArgs,
  ): Promise<FindOneResolverArgs> {
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
@WorkspaceQueryHook('messageDraft.groupBy')
export class MessageDraftGroupByPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: GroupByResolverArgs,
  ): Promise<GroupByResolverArgs> {
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
@WorkspaceQueryHook('messageDraft.findDuplicates')
export class MessageDraftFindDuplicatesPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    _payload: FindDuplicatesResolverArgs,
  ): Promise<FindDuplicatesResolverArgs> {
    this.accessService.requireUserAuthContext(authContext);

    return this.accessService.throwUnsupportedOperation('findDuplicates');
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.createOne')
export class MessageDraftCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateOneResolverArgs<MessageDraftData>,
  ): Promise<CreateOneResolverArgs<MessageDraftData>> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    if (payload.upsert === true) {
      return this.accessService.throwUnsupportedOperation('upsert');
    }

    const connectedAccountIds = this.accessService.requireConnectedAccountIds([
      payload.data.connectedAccountId,
    ]);

    await Promise.all([
      this.accessService.assertConnectedAccountsOwnedByUser({
        connectedAccountIds,
        authContext: userAuthContext,
      }),
      validateMessageThreadChange({
        accessService: this.accessService,
        authContext: userAuthContext,
        messageThreadId: payload.data.messageThreadId,
      }),
    ]);

    return {
      ...payload,
      data: this.accessService.forceAuthor(
        payload.data,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.createMany')
export class MessageDraftCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: CreateManyResolverArgs<MessageDraftData>,
  ): Promise<CreateManyResolverArgs<MessageDraftData>> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    if (payload.upsert === true) {
      return this.accessService.throwUnsupportedOperation('upsert');
    }

    const connectedAccountIds = this.accessService.requireConnectedAccountIds(
      payload.data.map(({ connectedAccountId }) => connectedAccountId),
    );

    await Promise.all([
      this.accessService.assertConnectedAccountsOwnedByUser({
        connectedAccountIds,
        authContext: userAuthContext,
      }),
      this.accessService.assertMessageThreadsOwnedByUser({
        messageThreadIds: payload.data
          .map(({ messageThreadId }) => messageThreadId)
          .filter(isDefined),
        authContext: userAuthContext,
      }),
    ]);

    return {
      ...payload,
      data: payload.data.map((data) =>
        this.accessService.forceAuthor(data, userAuthContext.workspaceMemberId),
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.updateOne')
export class MessageDraftUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs<MessageDraftData>,
  ): Promise<UpdateOneResolverArgs<MessageDraftData>> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await Promise.all([
      this.accessService.assertDraftIdsOwnedByUser({
        draftIds: [payload.id],
        authContext: userAuthContext,
      }),
      validateConnectedAccountChange({
        accessService: this.accessService,
        authContext: userAuthContext,
        connectedAccountId: payload.data.connectedAccountId,
      }),
      validateMessageThreadChange({
        accessService: this.accessService,
        authContext: userAuthContext,
        messageThreadId: payload.data.messageThreadId,
      }),
    ]);

    return {
      ...payload,
      data: this.accessService.forceAuthor(
        payload.data,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.updateMany')
export class MessageDraftUpdateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateManyResolverArgs<MessageDraftData, ObjectRecordFilter>,
  ): Promise<UpdateManyResolverArgs<MessageDraftData, ObjectRecordFilter>> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await Promise.all([
      validateConnectedAccountChange({
        accessService: this.accessService,
        authContext: userAuthContext,
        connectedAccountId: payload.data.connectedAccountId,
      }),
      validateMessageThreadChange({
        accessService: this.accessService,
        authContext: userAuthContext,
        messageThreadId: payload.data.messageThreadId,
      }),
    ]);

    return {
      ...payload,
      filter: this.accessService.addOwnerFilter(
        payload.filter,
        userAuthContext.workspaceMemberId,
      ),
      data: this.accessService.forceAuthor(
        payload.data,
        userAuthContext.workspaceMemberId,
      ),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.deleteOne')
export class MessageDraftDeleteOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DeleteOneResolverArgs,
  ): Promise<DeleteOneResolverArgs> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.assertDraftIdsOwnedByUser({
      draftIds: [payload.id],
      authContext: userAuthContext,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.deleteMany')
export class MessageDraftDeleteManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DeleteManyResolverArgs<ObjectRecordFilter>,
  ): Promise<DeleteManyResolverArgs<ObjectRecordFilter>> {
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
@WorkspaceQueryHook('messageDraft.destroyOne')
export class MessageDraftDestroyOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DestroyOneResolverArgs,
  ): Promise<DestroyOneResolverArgs> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.assertDraftIdsOwnedByUser({
      draftIds: [payload.id],
      authContext: userAuthContext,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.destroyMany')
export class MessageDraftDestroyManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: DestroyManyResolverArgs<ObjectRecordFilter>,
  ): Promise<DestroyManyResolverArgs<ObjectRecordFilter>> {
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
@WorkspaceQueryHook('messageDraft.restoreOne')
export class MessageDraftRestoreOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: RestoreOneResolverArgs,
  ): Promise<RestoreOneResolverArgs> {
    const userAuthContext =
      this.accessService.requireUserAuthContext(authContext);

    await this.accessService.assertDraftIdsOwnedByUser({
      draftIds: [payload.id],
      authContext: userAuthContext,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('messageDraft.restoreMany')
export class MessageDraftRestoreManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: RestoreManyResolverArgs<ObjectRecordFilter>,
  ): Promise<RestoreManyResolverArgs<ObjectRecordFilter>> {
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
@WorkspaceQueryHook('messageDraft.mergeMany')
export class MessageDraftMergeManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly accessService: MessageDraftAccessService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    _payload: MergeManyResolverArgs,
  ): Promise<MergeManyResolverArgs> {
    this.accessService.requireUserAuthContext(authContext);

    return this.accessService.throwUnsupportedOperation('mergeMany');
  }
}
