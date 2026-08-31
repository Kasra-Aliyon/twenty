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
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

const OPEN_LINKEDIN_ACTION_STATUSES = [
  LINKEDIN_ACTION_STATUSES.SCHEDULED,
  LINKEDIN_ACTION_STATUSES.CLAIMED,
];
const OPEN_TASK_STATUSES = ['TODO', 'IN_PROGRESS'] as const;

// Dedicated sequence clients can opt into atomic JSON patch semantics while
// the generic workspace API keeps its existing replacement semantics.
export const SEQUENCE_SETTINGS_ATOMIC_PATCH_MARKER =
  '__twentySequenceSettingsAtomicPatch';
export const SEQUENCE_STEP_SETTINGS_PATCH_BASE_TYPE =
  '__twentySequenceStepSettingsPatchBaseType';
export const SEQUENCE_STEP_ATOMIC_APPEND_MARKER =
  '__twentySequenceStepAtomicAppend';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAtomicSettingsPatch = (value: unknown): value is UnknownRecord =>
  isRecord(value) && value[SEQUENCE_SETTINGS_ATOMIC_PATCH_MARKER] === true;

const isAtomicStepAppend = (value: unknown): value is UnknownRecord =>
  isRecord(value) && value[SEQUENCE_STEP_ATOMIC_APPEND_MARKER] === true;

const withoutAtomicPatchMetadata = (value: UnknownRecord): UnknownRecord => {
  const patch = { ...value };

  delete patch[SEQUENCE_SETTINGS_ATOMIC_PATCH_MARKER];
  delete patch[SEQUENCE_STEP_SETTINGS_PATCH_BASE_TYPE];
  delete patch[SEQUENCE_STEP_ATOMIC_APPEND_MARKER];

  return patch;
};

const areSequenceStepsInSameBranch = (
  firstStep: SequenceStepWorkspaceEntity,
  secondStep: SequenceStepWorkspaceEntity,
): boolean => {
  const firstBranch = firstStep.settings.branch;
  const secondBranch = secondStep.settings.branch;

  if (!isDefined(firstBranch) || !isDefined(secondBranch)) {
    return !isDefined(firstBranch) && !isDefined(secondBranch);
  }

  return (
    firstBranch.conditionStepId === secondBranch.conditionStepId &&
    firstBranch.outcome === secondBranch.outcome
  );
};

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

    const serializedData = isAtomicSettingsPatch(data.settings)
      ? {
          ...data,
          settings: {
            ...(await this.getLockedSequenceSettings({
              authContext,
              sequenceId,
              workspaceEntityManager,
            })),
            ...withoutAtomicPatchMetadata(data.settings),
          },
        }
      : data;

    await this.invariantService.assertSequenceUpdateAllowed({
      authContext,
      sequenceId,
      data: serializedData,
    });

    return this.invariantService.normalizeSequenceUpdate(serializedData);
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
    data,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    data: Partial<SequenceStepWorkspaceEntity>[];
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<Partial<SequenceStepWorkspaceEntity>[]> {
    const sequenceIds = data.map(({ sequenceId }) => sequenceId);

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

    if (!data.some(({ settings }) => isAtomicStepAppend(settings))) {
      return data;
    }

    const stepRepository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceStepWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const uniqueSequenceIds = [...new Set(sequenceIds.filter(isDefined))];
    const existingSteps = await stepRepository.find(
      {
        where: { sequenceId: In(uniqueSequenceIds) },
        select: ['sequenceId', 'position'],
      },
      workspaceEntityManager,
    );
    const maximumPositionBySequenceId = new Map<string, number>();

    for (const step of [...existingSteps, ...data]) {
      if (
        !isDefined(step.sequenceId) ||
        !isDefined(step.position) ||
        !Number.isFinite(step.position)
      ) {
        continue;
      }

      maximumPositionBySequenceId.set(
        step.sequenceId,
        Math.max(
          maximumPositionBySequenceId.get(step.sequenceId) ?? -1,
          step.position,
        ),
      );
    }

    return data.map((step) => {
      if (!isAtomicStepAppend(step.settings) || !isDefined(step.sequenceId)) {
        return step;
      }

      const position =
        (maximumPositionBySequenceId.get(step.sequenceId) ?? -1) + 1;

      maximumPositionBySequenceId.set(step.sequenceId, position);

      return {
        ...step,
        position,
        settings: withoutAtomicPatchMetadata(step.settings) as
          | SequenceStepWorkspaceEntity['settings']
          | undefined,
      };
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
    requestedPosition,
    requestedSettings,
    stepId,
    updatedFields,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    nextSequenceId?: string;
    requestedPosition?: number | null;
    requestedSettings?: SequenceStepWorkspaceEntity['settings'] | null;
    stepId: string;
    updatedFields?: string[];
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<SequenceStepWorkspaceEntity['settings'] | null | undefined> {
    if (
      requestedPosition !== undefined &&
      (typeof requestedPosition !== 'number' ||
        !Number.isFinite(requestedPosition) ||
        requestedPosition < 0)
    ) {
      this.throwBadRequest('The sequence step position must be non-negative');
    }

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

    const serializedSettings = isAtomicSettingsPatch(requestedSettings)
      ? await this.mergeLockedStepSettingsPatch({
          authContext,
          requestedSettings,
          stepId,
          workspaceEntityManager,
        })
      : requestedSettings;

    await this.invariantService.assertStepUpdateAllowed({
      authContext,
      stepId,
      nextSequenceId,
      nextSettings: serializedSettings,
      updatedFields,
    });

    if (
      isDefined(requestedPosition) ||
      isDefined(serializedSettings) ||
      (isDefined(nextSequenceId) && nextSequenceId !== currentSequenceId)
    ) {
      await this.swapStepAtRequestedPosition({
        authContext,
        currentSequenceId,
        nextSequenceId,
        requestedPosition,
        requestedSettings: isDefined(serializedSettings)
          ? serializedSettings
          : undefined,
        stepId,
        workspaceEntityManager,
      });
    }

    return serializedSettings;
  }

  private async getLockedSequenceSettings({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<SequenceWorkspaceEntity['settings']> {
    const repository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const sequence = await repository.findOne(
      {
        where: { id: sequenceId },
        select: ['id', 'settings'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (!isDefined(sequence)) {
      this.throwBadRequest('The sequence was not found');
    }

    return sequence.settings;
  }

  private async mergeLockedStepSettingsPatch({
    authContext,
    requestedSettings,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    requestedSettings: UnknownRecord;
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<SequenceStepWorkspaceEntity['settings']> {
    const repository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceStepWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const currentStep = await repository.findOne(
      {
        where: { id: stepId },
        select: ['id', 'settings'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (!isDefined(currentStep)) {
      this.throwBadRequest('The sequence step was not found');
    }

    const expectedBaseType =
      requestedSettings[SEQUENCE_STEP_SETTINGS_PATCH_BASE_TYPE];
    const currentType = currentStep.settings.type;

    if (expectedBaseType !== currentType) {
      this.throwBadRequest(
        'The sequence step type changed while it was being patched; retry the change',
      );
    }

    const patch = withoutAtomicPatchMetadata(requestedSettings);

    if (patch.type !== currentType) {
      return patch as SequenceStepWorkspaceEntity['settings'];
    }

    const mergedSettings: UnknownRecord = {
      ...currentStep.settings,
      ...patch,
    };

    if (patch.branch === null) {
      delete mergedSettings.branch;
    }

    if (patch.variants === null) {
      delete mergedSettings.variants;
    }

    return mergedSettings as SequenceStepWorkspaceEntity['settings'];
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

  private async swapStepAtRequestedPosition({
    authContext,
    currentSequenceId,
    nextSequenceId,
    requestedPosition,
    requestedSettings,
    stepId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    currentSequenceId: string;
    nextSequenceId?: string;
    requestedPosition?: number;
    requestedSettings?: SequenceStepWorkspaceEntity['settings'];
    stepId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const repository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceStepWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const currentStep = await repository.findOne(
      {
        where: { id: stepId, sequenceId: currentSequenceId },
        select: ['id', 'position', 'settings', 'sequenceId'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (!isDefined(currentStep)) {
      this.throwBadRequest(
        'The sequence step changed while its position was being serialized; retry the change',
      );
    }

    const targetSequenceId = nextSequenceId ?? currentSequenceId;
    const targetPosition = requestedPosition ?? currentStep.position;
    const projectedStep = isDefined(requestedSettings)
      ? { ...currentStep, settings: requestedSettings }
      : currentStep;
    const changesBranch = !areSequenceStepsInSameBranch(
      currentStep,
      projectedStep,
    );

    if (
      currentStep.position === targetPosition &&
      targetSequenceId === currentSequenceId &&
      !changesBranch
    ) {
      return;
    }

    const targetPositionSteps = await repository.find(
      {
        where: { sequenceId: targetSequenceId, position: targetPosition },
        select: ['id', 'position', 'settings', 'sequenceId'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );
    const occupyingStep = targetPositionSteps.find(
      (candidateStep) =>
        candidateStep.id !== currentStep.id &&
        areSequenceStepsInSameBranch(candidateStep, projectedStep),
    );

    if (!isDefined(occupyingStep)) {
      return;
    }

    if (targetSequenceId !== currentSequenceId || changesBranch) {
      this.throwBadRequest(
        'The target sequence branch already has a step at that position; choose an unused position before moving the step',
      );
    }

    const swapResult = await repository.update(
      {
        id: occupyingStep.id,
        sequenceId: targetSequenceId,
        position: targetPosition,
      },
      { position: currentStep.position },
      workspaceEntityManager,
    );

    if (swapResult.affected !== 1) {
      throw new Error(
        `Failed to serialize sequence step position swap for ${stepId}`,
      );
    }
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
          'currentStepId',
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
    const sendAttempt = enrollment.lastSendAttempt;
    const hasUnresolvedEmailSendClaim =
      isDefined(sendAttempt) &&
      enrollment.waitingOn === SEQUENCE_WAITING_ON.EMAIL_SCHEDULED &&
      enrollment.currentStepId === sendAttempt.stepId &&
      !isDefined(enrollment.sentEmailsByStepId?.[sendAttempt.stepId]);

    if (hasUnresolvedEmailSendClaim) {
      this.throwBadRequest(
        'Wait for the interrupted sequence email to recover before advancing the enrollment',
      );
    }

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

    if (scheduledActionIds.length > 0) {
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

    if (
      !isDefined(enrollment.currentStepId) ||
      (enrollment.waitingOn !== SEQUENCE_WAITING_ON.TASK_DONE &&
        enrollment.waitingOn !== SEQUENCE_WAITING_ON.TASK_DEADLINE)
    ) {
      return;
    }

    const taskRepository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      TaskWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );

    await taskRepository.update(
      {
        sequenceEnrollmentId: enrollment.id,
        sequenceStepId: enrollment.currentStepId,
        status: In(OPEN_TASK_STATUSES),
      },
      { status: 'DONE' },
      workspaceEntityManager,
    );
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
