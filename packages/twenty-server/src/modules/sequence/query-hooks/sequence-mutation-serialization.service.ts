import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { hasLiveSequenceEmailSendLease } from 'src/modules/sequence/utils/has-live-sequence-email-send-lease.util';

const OPEN_LINKEDIN_ACTION_STATUSES = [
  LINKEDIN_ACTION_STATUSES.SCHEDULED,
  LINKEDIN_ACTION_STATUSES.CLAIMED,
];

@Injectable()
export class SequenceMutationSerializationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly invariantService: SequenceInvariantService,
  ) {}

  async serializeSequenceUpdate({
    authContext,
    data,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    data: Partial<SequenceWorkspaceEntity>;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<Partial<SequenceWorkspaceEntity>> {
    await this.lockSequences({
      authContext,
      sequenceIds: [sequenceId],
      workspaceEntityManager,
    });
    await this.invariantService.assertSequenceUpdateAllowed({
      authContext,
      sequenceId,
      data,
    });

    return this.invariantService.normalizeSequenceUpdate(data);
  }

  async serializeSequenceArchive({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    await this.lockSequences({
      authContext,
      sequenceIds: [sequenceId],
      workspaceEntityManager,
    });
    await this.invariantService.assertSequenceArchiveAllowed({
      authContext,
      sequenceId,
    });
  }

  async serializeSequenceRestore({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    await this.lockSequences({
      authContext,
      sequenceIds: [sequenceId],
      workspaceEntityManager,
    });
    await this.invariantService.assertSequenceRestoreAllowed({
      authContext,
      sequenceId,
    });
  }

  async serializeSequenceDestroy({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    await this.lockSequences({
      authContext,
      sequenceIds: [sequenceId],
      workspaceEntityManager,
    });
    await this.invariantService.assertSequenceDestroyAllowed({
      authContext,
      sequenceId,
    });
  }

  async serializeStepCreates({
    authContext,
    sequenceIds,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: (string | undefined)[];
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    if (sequenceIds.some((sequenceId) => !isDefined(sequenceId))) {
      this.throwBadRequest('Every sequence step requires a sequence');
    }

    await this.lockSequences({
      authContext,
      sequenceIds: sequenceIds.filter(isDefined),
      workspaceEntityManager,
    });
    await this.invariantService.assertStepCreateAllowed({
      authContext,
      sequenceIds,
    });
  }

  async serializeEnrollmentCreates({
    authContext,
    data,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    data: Partial<SequenceEnrollmentWorkspaceEntity>[];
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<Partial<SequenceEnrollmentWorkspaceEntity>[]> {
    const sequenceIds = data.map(({ sequenceId }) => sequenceId);

    if (sequenceIds.some((sequenceId) => !isDefined(sequenceId))) {
      this.throwBadRequest('Every enrollment requires a sequence');
    }

    await this.lockSequences({
      authContext,
      sequenceIds: sequenceIds.filter(isDefined),
      workspaceEntityManager,
    });

    return this.invariantService.normalizeEnrollmentCreates({
      authContext,
      data,
    });
  }

  async serializeEnrollmentUpdate({
    authContext,
    data,
    enrollmentId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    data: Partial<SequenceEnrollmentWorkspaceEntity>;
    enrollmentId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<Partial<SequenceEnrollmentWorkspaceEntity>> {
    const candidateEnrollment = await this.getEnrollmentForMutation({
      authContext,
      enrollmentId,
      workspaceEntityManager,
      shouldLock: false,
    });

    await this.lockSequences({
      authContext,
      sequenceIds: [candidateEnrollment.sequenceId],
      workspaceEntityManager,
    });

    const lockedEnrollment = await this.getEnrollmentForMutation({
      authContext,
      enrollmentId,
      workspaceEntityManager,
      shouldLock: true,
    });

    if (lockedEnrollment.sequenceId !== candidateEnrollment.sequenceId) {
      this.throwBadRequest(
        'The sequence enrollment changed while the mutation was being serialized; retry the change',
      );
    }

    const normalizedData =
      await this.invariantService.normalizeEnrollmentUpdate({
        authContext,
        enrollmentId,
        data,
      });

    if (this.isSkipNowUpdate(data)) {
      await this.prepareEnrollmentSkip({
        authContext,
        enrollment: lockedEnrollment,
        workspaceEntityManager,
      });
    }

    return normalizedData;
  }

  async serializeStepUpdate({
    authContext,
    nextSequenceId,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    nextSequenceId?: string;
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const currentSequenceId = await this.getStepSequenceId({
      authContext,
      stepId,
      workspaceEntityManager,
    });

    await this.lockSequences({
      authContext,
      sequenceIds: [currentSequenceId, nextSequenceId].filter(isDefined),
      workspaceEntityManager,
    });
    await this.assertStepStillBelongsToSequence({
      authContext,
      expectedSequenceId: currentSequenceId,
      stepId,
      workspaceEntityManager,
    });
    await this.invariantService.assertStepUpdateAllowed({
      authContext,
      stepId,
      nextSequenceId,
    });
  }

  async serializeStepDeletion({
    authContext,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const currentSequenceId = await this.getStepSequenceId({
      authContext,
      stepId,
      workspaceEntityManager,
    });

    await this.lockSequences({
      authContext,
      sequenceIds: [currentSequenceId],
      workspaceEntityManager,
    });
    await this.assertStepStillBelongsToSequence({
      authContext,
      expectedSequenceId: currentSequenceId,
      stepId,
      workspaceEntityManager,
    });
    await this.invariantService.assertStepDeletionAllowed({
      authContext,
      stepId,
    });
  }

  async serializeStepMutation({
    authContext,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const currentSequenceId = await this.getStepSequenceId({
      authContext,
      stepId,
      workspaceEntityManager,
    });

    await this.lockSequences({
      authContext,
      sequenceIds: [currentSequenceId],
      workspaceEntityManager,
    });
    await this.assertStepStillBelongsToSequence({
      authContext,
      expectedSequenceId: currentSequenceId,
      stepId,
      workspaceEntityManager,
    });
    await this.invariantService.assertStepMutationAllowed({
      authContext,
      stepId,
    });
  }

  private async lockSequences({
    authContext,
    sequenceIds,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const uniqueSequenceIds = [...new Set(sequenceIds)].sort();
    const repository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const sequences = await repository.find(
      {
        where: { id: In(uniqueSequenceIds) },
        withDeleted: true,
        select: ['id'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (sequences.length !== uniqueSequenceIds.length) {
      this.throwBadRequest('One or more sequences were not found');
    }
  }

  private async getStepSequenceId({
    authContext,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<string> {
    const repository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceStepWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const step = await repository.findOne(
      {
        where: { id: stepId },
        withDeleted: true,
        select: ['id', 'sequenceId'],
      },
      workspaceEntityManager,
    );

    if (!isDefined(step)) {
      this.throwBadRequest('The sequence step was not found');
    }

    return step.sequenceId;
  }

  private async assertStepStillBelongsToSequence({
    authContext,
    expectedSequenceId,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    expectedSequenceId: string;
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const currentSequenceId = await this.getStepSequenceId({
      authContext,
      stepId,
      workspaceEntityManager,
    });

    if (currentSequenceId !== expectedSequenceId) {
      this.throwBadRequest(
        'The sequence step changed while the mutation was being serialized; retry the change',
      );
    }
  }

  private async getEnrollmentForMutation({
    authContext,
    enrollmentId,
    shouldLock,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    enrollmentId: string;
    shouldLock: boolean;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<SequenceEnrollmentWorkspaceEntity> {
    const repository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceEnrollmentWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const enrollment = await repository.findOne(
      {
        where: { id: enrollmentId },
        withDeleted: true,
        select: [
          'id',
          'sequenceId',
          'status',
          'waitingOn',
          'nextActionAt',
          'lastSendAttempt',
          'sentEmailsByStepId',
        ],
        ...(shouldLock ? { lock: { mode: 'pessimistic_write' } } : {}),
      },
      workspaceEntityManager,
    );

    if (!isDefined(enrollment)) {
      this.throwBadRequest('The sequence enrollment was not found');
    }

    return enrollment;
  }

  private isSkipNowUpdate(
    data: Partial<SequenceEnrollmentWorkspaceEntity>,
  ): boolean {
    return (
      data.waitingOn === SEQUENCE_WAITING_ON.DELAY &&
      Object.keys(data).every((fieldName) =>
        ['nextActionAt', 'waitingOn'].includes(fieldName),
      )
    );
  }

  private async prepareEnrollmentSkip({
    authContext,
    enrollment,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const now = new Date();

    if (hasLiveSequenceEmailSendLease({ enrollment, now })) {
      this.throwBadRequest(
        'Wait for the in-flight sequence email to finish before advancing the enrollment',
      );
    }

    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const openActions = await linkedinActionRepository.find(
      {
        where: {
          sequenceEnrollmentId: enrollment.id,
          status: In(OPEN_LINKEDIN_ACTION_STATUSES),
        },
        select: ['id', 'status'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (
      openActions.some(
        ({ status }) => status === LINKEDIN_ACTION_STATUSES.CLAIMED,
      )
    ) {
      this.throwBadRequest(
        'Wait for the in-flight LinkedIn action to finish before advancing the enrollment',
      );
    }

    const scheduledActionIds = openActions
      .filter(({ status }) => status === LINKEDIN_ACTION_STATUSES.SCHEDULED)
      .map(({ id }) => id);

    if (scheduledActionIds.length === 0) {
      return;
    }

    const cancellationResult = await linkedinActionRepository.update(
      {
        id: In(scheduledActionIds),
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
      {
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        claimedAt: null,
        claimedBy: null,
        executedAt: now,
        errorMessage: 'Sequence enrollment advanced manually',
      },
      workspaceEntityManager,
    );

    if (cancellationResult.affected !== scheduledActionIds.length) {
      throw new Error(
        `Failed to cancel queued LinkedIn actions before advancing sequence enrollment ${enrollment.id}`,
      );
    }
  }

  private throwBadRequest(message: string): never {
    throw new CommonQueryRunnerException(
      message,
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`This sequence change is not allowed in its current state.`,
      },
    );
  }
}
