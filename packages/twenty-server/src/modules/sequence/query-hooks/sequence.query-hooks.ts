import { Injectable } from '@nestjs/common';

import { SEQUENCE_STATUSES } from 'twenty-shared/types';

import { type QueryResultFieldValue } from 'src/engine/api/graphql/workspace-query-runner/factories/query-result-getters/interfaces/query-result-field-value';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import {
  type WorkspacePostQueryHookInstance,
  type WorkspacePreQueryHookInstance,
} from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHookType } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/types/workspace-query-hook.type';
import { markWorkspaceQueryForTransaction } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import {
  type CreateManyResolverArgs,
  type CreateOneResolverArgs,
  type DeleteManyResolverArgs,
  type DeleteOneResolverArgs,
  type DestroyManyResolverArgs,
  type DestroyOneResolverArgs,
  type MergeManyResolverArgs,
  type RestoreManyResolverArgs,
  type RestoreOneResolverArgs,
  type UpdateManyResolverArgs,
  type UpdateOneResolverArgs,
} from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';

import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { SequenceLifecycleService } from 'src/modules/sequence/query-hooks/sequence-lifecycle.service';
import { SequenceMutationSerializationService } from 'src/modules/sequence/query-hooks/sequence-mutation-serialization.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { type SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

const SEQUENCE_OBJECT_NAMES = new Set([
  'sequence',
  'sequenceEnrollment',
  'sequenceStep',
]);

const isSequenceObject = (objectName: string) =>
  SEQUENCE_OBJECT_NAMES.has(objectName);

@Injectable()
@WorkspaceQueryHook('*.createOne')
export class SequenceCreateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly invariantService: SequenceInvariantService,
    private readonly mutationSerializationService: SequenceMutationSerializationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateOneResolverArgs,
  ): Promise<CreateOneResolverArgs> {
    if (!isSequenceObject(objectName)) return payload;
    if (payload.upsert === true) {
      return this.invariantService.throwBulkMutationUnsupported(
        `${objectName} upsert`,
      );
    }

    if (objectName === 'sequence') {
      return {
        ...payload,
        data: this.invariantService.normalizeSequenceCreate(
          payload.data as Partial<SequenceWorkspaceEntity>,
        ),
      };
    }

    if (objectName === 'sequenceStep') {
      return markWorkspaceQueryForTransaction(payload);
    }

    return markWorkspaceQueryForTransaction(payload);
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<CreateOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      const [data] =
        await this.mutationSerializationService.serializeEnrollmentCreates({
          authContext,
          data: [payload.data as Partial<SequenceEnrollmentWorkspaceEntity>],
          workspaceEntityManager,
        });

      return { ...payload, data };
    }

    if (objectName !== 'sequenceStep') return payload;

    const data = payload.data as Partial<SequenceStepWorkspaceEntity>;

    await this.mutationSerializationService.serializeStepCreates({
      authContext,
      sequenceIds: [data.sequenceId],
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.createMany')
export class SequenceCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly invariantService: SequenceInvariantService,
    private readonly mutationSerializationService: SequenceMutationSerializationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateManyResolverArgs,
  ): Promise<CreateManyResolverArgs> {
    if (!isSequenceObject(objectName)) return payload;
    if (payload.upsert === true) {
      return this.invariantService.throwBulkMutationUnsupported(
        `${objectName} upsert`,
      );
    }

    if (objectName === 'sequence') {
      return {
        ...payload,
        data: payload.data.map((data) =>
          this.invariantService.normalizeSequenceCreate(
            data as Partial<SequenceWorkspaceEntity>,
          ),
        ),
      };
    }

    if (objectName === 'sequenceStep') {
      return markWorkspaceQueryForTransaction(payload);
    }

    return markWorkspaceQueryForTransaction(payload);
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateManyResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<CreateManyResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      return {
        ...payload,
        data: await this.mutationSerializationService.serializeEnrollmentCreates(
          {
            authContext,
            data: payload.data as Partial<SequenceEnrollmentWorkspaceEntity>[],
            workspaceEntityManager,
          },
        ),
      };
    }

    if (objectName !== 'sequenceStep') return payload;

    const data = payload.data as Partial<SequenceStepWorkspaceEntity>[];

    await this.mutationSerializationService.serializeStepCreates({
      authContext,
      sequenceIds: data.map(({ sequenceId }) => sequenceId),
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.updateOne')
export class SequenceUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly mutationSerializationService: SequenceMutationSerializationService,
    private readonly lifecycleService: SequenceLifecycleService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs,
  ): Promise<UpdateOneResolverArgs> {
    if (!isSequenceObject(objectName)) return payload;

    if (objectName === 'sequence') {
      return markWorkspaceQueryForTransaction(payload);
    }

    if (objectName === 'sequenceStep') {
      return markWorkspaceQueryForTransaction(payload);
    }

    return markWorkspaceQueryForTransaction(payload);
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<UpdateOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      return {
        ...payload,
        data: await this.mutationSerializationService.serializeEnrollmentUpdate(
          {
            authContext,
            enrollmentId: payload.id,
            data: payload.data as Partial<SequenceEnrollmentWorkspaceEntity>,
            workspaceEntityManager,
          },
        ),
      };
    }

    if (objectName === 'sequence') {
      return {
        ...payload,
        data: await this.mutationSerializationService.serializeSequenceUpdate({
          authContext,
          sequenceId: payload.id,
          data: payload.data as Partial<SequenceWorkspaceEntity>,
          workspaceEntityManager,
        }),
      };
    }

    if (objectName === 'sequenceStep') {
      await this.mutationSerializationService.serializeStepUpdate({
        authContext,
        stepId: payload.id,
        nextSequenceId: (payload.data as Partial<SequenceStepWorkspaceEntity>)
          .sequenceId,
        workspaceEntityManager,
      });
    }

    return payload;
  }

  async executeAfterMutationInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs,
    _result: QueryResultFieldValue,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<void> {
    if (
      objectName !== 'sequence' ||
      (payload.data as Partial<SequenceWorkspaceEntity>).status !==
        SEQUENCE_STATUSES.PAUSED
    ) {
      return;
    }

    await this.lifecycleService.quiesceOnPauseInTransaction({
      authContext,
      sequenceId: payload.id,
      workspaceEntityManager,
    });
  }
}

@Injectable()
@WorkspaceQueryHook('*.updateMany')
export class SequenceUpdateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateManyResolverArgs,
  ): Promise<UpdateManyResolverArgs> {
    if (!isSequenceObject(objectName)) return payload;

    return this.invariantService.throwBulkMutationUnsupported(objectName);
  }
}

@Injectable()
@WorkspaceQueryHook('*.deleteOne')
export class SequenceDeleteOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly invariantService: SequenceInvariantService,
    private readonly lifecycleService: SequenceLifecycleService,
    private readonly mutationSerializationService: SequenceMutationSerializationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteOneResolverArgs,
  ): Promise<DeleteOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      this.invariantService.throwEnrollmentDeletionUnsupported();
    }

    if (objectName === 'sequenceStep') {
      return markWorkspaceQueryForTransaction(payload);
    }

    if (objectName === 'sequence') {
      return markWorkspaceQueryForTransaction(payload);
    }

    return payload;
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<DeleteOneResolverArgs> {
    if (objectName === 'sequence') {
      await this.mutationSerializationService.serializeSequenceArchive({
        authContext,
        sequenceId: payload.id,
        workspaceEntityManager,
      });
      await this.lifecycleService.pauseBeforeArchiveInTransaction({
        authContext,
        sequenceId: payload.id,
        workspaceEntityManager,
      });

      return payload;
    }

    if (objectName !== 'sequenceStep') return payload;

    await this.mutationSerializationService.serializeStepDeletion({
      authContext,
      stepId: payload.id,
      workspaceEntityManager,
    });

    return payload;
  }

  async executeAfterMutationInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteOneResolverArgs,
    _result: QueryResultFieldValue,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<void> {
    if (objectName !== 'sequence') return;

    await this.lifecycleService.finalizeArchiveInTransaction({
      authContext,
      sequenceId: payload.id,
      workspaceEntityManager,
    });
  }
}

@Injectable()
@WorkspaceQueryHook('*.destroyOne')
export class SequenceDestroyOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly invariantService: SequenceInvariantService,
    private readonly lifecycleService: SequenceLifecycleService,
    private readonly mutationSerializationService: SequenceMutationSerializationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
  ): Promise<DestroyOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      this.invariantService.throwEnrollmentDeletionUnsupported();
    }

    if (objectName === 'sequenceStep') {
      return markWorkspaceQueryForTransaction(payload);
    }

    if (objectName === 'sequence') {
      return markWorkspaceQueryForTransaction(payload);
    }

    return payload;
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<DestroyOneResolverArgs> {
    if (objectName === 'sequence') {
      await this.mutationSerializationService.serializeSequenceDestroy({
        authContext,
        sequenceId: payload.id,
        workspaceEntityManager,
      });
      await this.lifecycleService.preparePermanentDeletionInTransaction({
        authContext,
        sequenceId: payload.id,
        workspaceEntityManager,
      });

      return payload;
    }

    if (objectName !== 'sequenceStep') return payload;

    await this.mutationSerializationService.serializeStepDeletion({
      authContext,
      stepId: payload.id,
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.restoreOne')
export class SequenceRestoreOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly invariantService: SequenceInvariantService,
    private readonly mutationSerializationService: SequenceMutationSerializationService,
  ) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: RestoreOneResolverArgs,
  ): Promise<RestoreOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      this.invariantService.throwEnrollmentDeletionUnsupported();
    }

    if (objectName === 'sequenceStep') {
      return markWorkspaceQueryForTransaction(payload);
    }

    if (objectName === 'sequence') {
      return markWorkspaceQueryForTransaction(payload);
    }

    return payload;
  }

  async executeInTransaction(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: RestoreOneResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<RestoreOneResolverArgs> {
    if (objectName === 'sequence') {
      await this.mutationSerializationService.serializeSequenceRestore({
        authContext,
        sequenceId: payload.id,
        workspaceEntityManager,
      });

      return payload;
    }

    if (objectName !== 'sequenceStep') return payload;

    await this.mutationSerializationService.serializeStepMutation({
      authContext,
      stepId: payload.id,
      workspaceEntityManager,
    });

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook({
  key: 'sequence.deleteOne',
  type: WorkspaceQueryHookType.POST_HOOK,
})
export class SequenceDeleteOnePostQueryHook implements WorkspacePostQueryHookInstance {
  constructor(private readonly lifecycleService: SequenceLifecycleService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: SequenceWorkspaceEntity[],
  ): Promise<void> {
    for (const sequence of payload) {
      await this.lifecycleService.recomputeMetricsAfterArchive({
        authContext,
        sequenceId: sequence.id,
      });
    }
  }
}

const assertBulkMutationAllowed = (
  invariantService: SequenceInvariantService,
  objectName: string,
  payload:
    | DeleteManyResolverArgs
    | DestroyManyResolverArgs
    | RestoreManyResolverArgs,
) => {
  if (!isSequenceObject(objectName)) return payload;

  if (objectName === 'sequenceEnrollment') {
    return invariantService.throwEnrollmentDeletionUnsupported();
  }

  return invariantService.throwBulkMutationUnsupported(objectName);
};

@Injectable()
@WorkspaceQueryHook('*.deleteMany')
export class SequenceDeleteManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteManyResolverArgs,
  ): Promise<DeleteManyResolverArgs> {
    return assertBulkMutationAllowed(
      this.invariantService,
      objectName,
      payload,
    );
  }
}

@Injectable()
@WorkspaceQueryHook('*.destroyMany')
export class SequenceDestroyManyPreQueryHook extends SequenceDeleteManyPreQueryHook {
  constructor(invariantService: SequenceInvariantService) {
    super(invariantService);
  }
}

@Injectable()
@WorkspaceQueryHook('*.restoreMany')
export class SequenceRestoreManyPreQueryHook extends SequenceDeleteManyPreQueryHook {
  constructor(invariantService: SequenceInvariantService) {
    super(invariantService);
  }
}

@Injectable()
@WorkspaceQueryHook('*.mergeMany')
export class SequenceMergeManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    _authContext: WorkspaceAuthContext,
    objectName: string,
    payload: MergeManyResolverArgs,
  ): Promise<MergeManyResolverArgs> {
    if (!isSequenceObject(objectName)) return payload;

    return this.invariantService.throwBulkMutationUnsupported(objectName);
  }
}
