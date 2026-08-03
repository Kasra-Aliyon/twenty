import { Injectable } from '@nestjs/common';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import {
  type WorkspacePostQueryHookInstance,
  type WorkspacePreQueryHookInstance,
} from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHookType } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/types/workspace-query-hook.type';
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
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { SequenceLifecycleService } from 'src/modules/sequence/query-hooks/sequence-lifecycle.service';
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
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    authContext: WorkspaceAuthContext,
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
      const data = payload.data as Partial<SequenceStepWorkspaceEntity>;

      await this.invariantService.assertStepCreateAllowed({
        authContext,
        sequenceIds: [data.sequenceId],
      });

      return payload;
    }

    const [data] = await this.invariantService.normalizeEnrollmentCreates({
      authContext,
      data: [payload.data as Partial<SequenceEnrollmentWorkspaceEntity>],
    });

    return { ...payload, data };
  }
}

@Injectable()
@WorkspaceQueryHook('*.createMany')
export class SequenceCreateManyPreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    authContext: WorkspaceAuthContext,
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
      const data = payload.data as Partial<SequenceStepWorkspaceEntity>[];

      await this.invariantService.assertStepCreateAllowed({
        authContext,
        sequenceIds: data.map(({ sequenceId }) => sequenceId),
      });

      return payload;
    }

    return {
      ...payload,
      data: await this.invariantService.normalizeEnrollmentCreates({
        authContext,
        data: payload.data as Partial<SequenceEnrollmentWorkspaceEntity>[],
      }),
    };
  }
}

@Injectable()
@WorkspaceQueryHook('*.updateOne')
export class SequenceUpdateOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs,
  ): Promise<UpdateOneResolverArgs> {
    if (!isSequenceObject(objectName)) return payload;

    if (objectName === 'sequence') {
      await this.invariantService.assertSequenceUpdateAllowed({
        authContext,
        sequenceId: payload.id,
        data: payload.data as Partial<SequenceWorkspaceEntity>,
      });

      return payload;
    }

    if (objectName === 'sequenceStep') {
      await this.invariantService.assertStepUpdateAllowed({
        authContext,
        stepId: payload.id,
        nextSequenceId: (payload.data as Partial<SequenceStepWorkspaceEntity>)
          .sequenceId,
      });

      return payload;
    }

    return {
      ...payload,
      data: await this.invariantService.normalizeEnrollmentUpdate({
        authContext,
        enrollmentId: payload.id,
        data: payload.data as Partial<SequenceEnrollmentWorkspaceEntity>,
      }),
    };
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
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DeleteOneResolverArgs,
  ): Promise<DeleteOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      this.invariantService.throwEnrollmentDeletionUnsupported();
    }

    if (objectName === 'sequenceStep') {
      await this.invariantService.assertStepMutationAllowed({
        authContext,
        stepId: payload.id,
      });
    }

    if (objectName === 'sequence') {
      await this.invariantService.assertSequenceArchiveAllowed({
        authContext,
        sequenceId: payload.id,
      });
      await this.lifecycleService.pauseBeforeArchive({
        authContext,
        sequenceId: payload.id,
      });
    }

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.destroyOne')
export class SequenceDestroyOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(
    private readonly invariantService: SequenceInvariantService,
    private readonly lifecycleService: SequenceLifecycleService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: DestroyOneResolverArgs,
  ): Promise<DestroyOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      this.invariantService.throwEnrollmentDeletionUnsupported();
    }

    if (objectName === 'sequenceStep') {
      await this.invariantService.assertStepMutationAllowed({
        authContext,
        stepId: payload.id,
      });
    }

    if (objectName === 'sequence') {
      await this.invariantService.assertSequenceDestroyAllowed({
        authContext,
        sequenceId: payload.id,
      });
      await this.lifecycleService.preparePermanentDeletion({
        authContext,
        sequenceId: payload.id,
      });
    }

    return payload;
  }
}

@Injectable()
@WorkspaceQueryHook('*.restoreOne')
export class SequenceRestoreOnePreQueryHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly invariantService: SequenceInvariantService) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: RestoreOneResolverArgs,
  ): Promise<RestoreOneResolverArgs> {
    if (objectName === 'sequenceEnrollment') {
      this.invariantService.throwEnrollmentDeletionUnsupported();
    }

    if (objectName === 'sequenceStep') {
      await this.invariantService.assertStepMutationAllowed({
        authContext,
        stepId: payload.id,
      });
    }

    if (objectName === 'sequence') {
      await this.invariantService.assertSequenceRestoreAllowed({
        authContext,
        sequenceId: payload.id,
      });
    }

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
      await this.lifecycleService.finalizeArchive({
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
