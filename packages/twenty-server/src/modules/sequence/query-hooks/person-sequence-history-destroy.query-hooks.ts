import { Injectable } from '@nestjs/common';

import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { markWorkspaceQueryForTransaction } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import {
  type DestroyManyResolverArgs,
  type DestroyOneResolverArgs,
  type MergeManyResolverArgs,
} from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { PersonSequenceHistoryDestroyGuardService } from 'src/modules/sequence/query-hooks/person-sequence-history-destroy-guard.service';

const PERSON_OBJECT_NAME = 'person';
const EMPTY_TARGET_ID = '00000000-0000-0000-0000-000000000000';

const buildExactTargetFilter = (
  personIds: string[],
): Partial<ObjectRecordFilter> =>
  personIds.length > 0
    ? { id: { in: personIds } }
    : {
        and: [
          { id: { eq: EMPTY_TARGET_ID } },
          { not: { id: { eq: EMPTY_TARGET_ID } } },
        ],
      };

@Injectable()
@WorkspaceQueryHook('*.destroyOne')
export class PersonSequenceHistoryDestroyOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly destroyGuardService: PersonSequenceHistoryDestroyGuardService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
  ): Promise<DestroyOneResolverArgs> {
    if (objectName !== PERSON_OBJECT_NAME) return payload;

    return markWorkspaceQueryForTransaction(payload);
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<DestroyOneResolverArgs> {
    if (objectName !== PERSON_OBJECT_NAME) return payload;

    await this.destroyGuardService.preparePermanentPersonDestroy({
      authContext,
      filter: { id: { eq: payload.id } },
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.destroyMany')
export class PersonSequenceHistoryDestroyManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly destroyGuardService: PersonSequenceHistoryDestroyGuardService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyManyResolverArgs,
  ): Promise<DestroyManyResolverArgs> {
    if (objectName !== PERSON_OBJECT_NAME) return payload;

    return markWorkspaceQueryForTransaction(payload);
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyManyResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<DestroyManyResolverArgs> {
    if (objectName !== PERSON_OBJECT_NAME) return payload;

    const personIds =
      await this.destroyGuardService.preparePermanentPersonDestroy({
        authContext,
        filter: payload.filter,
        workspaceEntityManager,
      });

    // Replacing the filter pins the mutation to the rows that were checked and
    // locked. A relation used by the caller's filter cannot race the guard and
    // make an unchecked person newly eligible for deletion.
    return {
      ...payload,
      filter: buildExactTargetFilter(personIds),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.mergeMany')
export class PersonSequenceHistoryMergeManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly destroyGuardService: PersonSequenceHistoryDestroyGuardService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: MergeManyResolverArgs,
  ): Promise<MergeManyResolverArgs> {
    if (objectName !== PERSON_OBJECT_NAME || payload.dryRun === true) {
      return payload;
    }

    return markWorkspaceQueryForTransaction(payload);
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: MergeManyResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<MergeManyResolverArgs> {
    if (objectName !== PERSON_OBJECT_NAME || payload.dryRun === true) {
      return payload;
    }

    const priorityPersonId = payload.ids[payload.conflictPriorityIndex];
    const sourcePersonIds = payload.ids.filter(
      (personId) => personId !== priorityPersonId,
    );

    if (sourcePersonIds.length === 0) {
      return payload;
    }

    // Lock every merge participant in the guard's deterministic order so two
    // merges with opposite priority choices cannot deadlock on source/target.
    // Only the source People are checked because only they are hard-deleted.
    await this.destroyGuardService.preparePermanentPersonDestroy({
      authContext,
      filter: { id: { in: payload.ids } },
      personIdsToCheckForHistory: sourcePersonIds,
      workspaceEntityManager,
    });

    return payload;
  }
}
