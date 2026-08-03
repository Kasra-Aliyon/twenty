import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceEnrollmentStatus,
} from 'twenty-shared/types';
import { In } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';

const SEQUENCE_ENGINE_FIELDS = new Set([
  'activeCount',
  'completedCount',
  'enrolledCount',
  'failedCount',
  'repliedCount',
]);

const TERMINAL_USER_STATUSES: ReadonlySet<SequenceEnrollmentStatus> = new Set([
  SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
  SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
]);

@Injectable()
export class SequenceInvariantService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceSenderService: SequenceSenderService,
  ) {}

  normalizeSequenceCreate(
    data: Partial<SequenceWorkspaceEntity>,
  ): Partial<SequenceWorkspaceEntity> {
    return {
      ...data,
      status: SEQUENCE_STATUSES.DRAFT,
      enrolledCount: 0,
      activeCount: 0,
      completedCount: 0,
      repliedCount: 0,
      failedCount: 0,
    };
  }

  async normalizeEnrollmentCreates({
    authContext,
    data,
  }: {
    authContext: WorkspaceAuthContext;
    data: Partial<SequenceEnrollmentWorkspaceEntity>[];
  }): Promise<Partial<SequenceEnrollmentWorkspaceEntity>[]> {
    const sequenceIds = [
      ...new Set(data.map(({ sequenceId }) => sequenceId).filter(Boolean)),
    ] as string[];

    if (data.some(({ sequenceId }) => !sequenceId)) {
      this.throwBadRequest('Every enrollment requires a sequence');
    }

    const sequences = await this.getSequences({ authContext, sequenceIds });
    const sequenceById = new Map(
      sequences.map((sequence) => [sequence.id, sequence]),
    );

    return data.map((input) => {
      const sequence = sequenceById.get(input.sequenceId as string);

      if (!sequence) {
        this.throwBadRequest('The sequence for this enrollment was not found');
      }

      if (sequence.deletedAt) {
        this.throwBadRequest(
          'People cannot be enrolled in an archived sequence',
        );
      }

      return {
        id: input.id,
        sequenceId: input.sequenceId,
        personId: input.personId,
        position: input.position,
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        currentStepId: null,
        currentStepPosition: -1,
        waitingOn: null,
        nextActionAt: null,
        senderConnectedAccountId: sequence.senderConnectedAccountId,
        stopOnReply: parseSequenceSettings(sequence.settings).stopOnReply,
        startedAt: null,
        endedAt: null,
        errorMessage: null,
        sentEmailsByStepId: {},
        lastSendAttempt: null,
      };
    });
  }

  async normalizeEnrollmentUpdate({
    authContext,
    enrollmentId,
    data,
  }: {
    authContext: WorkspaceAuthContext;
    enrollmentId: string;
    data: Partial<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<Partial<SequenceEnrollmentWorkspaceEntity>> {
    const enrollment = await this.getEnrollment({
      authContext,
      enrollmentId,
    });
    const fieldNames = Object.keys(data);
    const requestedStatus = data.status;

    if (
      requestedStatus &&
      TERMINAL_USER_STATUSES.has(requestedStatus) &&
      fieldNames.every((fieldName) =>
        ['endedAt', 'status'].includes(fieldName),
      ) &&
      new Set<SequenceEnrollmentStatus>([
        SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      ]).has(enrollment.status)
    ) {
      return {
        status: requestedStatus,
        endedAt: new Date(),
        waitingOn: null,
        nextActionAt: null,
      };
    }

    if (
      enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE &&
      data.waitingOn === SEQUENCE_WAITING_ON.DELAY &&
      fieldNames.every((fieldName) =>
        ['nextActionAt', 'waitingOn'].includes(fieldName),
      )
    ) {
      return {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(),
      };
    }

    this.throwBadRequest(
      'Enrollment execution state can only be changed through a supported enrollment action',
    );
  }

  async assertStepCreateAllowed({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: (string | undefined)[];
  }): Promise<void> {
    if (sequenceIds.some((sequenceId) => !sequenceId)) {
      this.throwBadRequest('Every sequence step requires a sequence');
    }

    await this.assertSequencesEditable({
      authContext,
      sequenceIds: sequenceIds as string[],
    });
  }

  async assertStepUpdateAllowed({
    authContext,
    stepId,
    nextSequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
    nextSequenceId?: string;
  }): Promise<void> {
    const steps = await this.getSteps({ authContext, stepIds: [stepId] });
    const step = steps[0];

    if (!step) {
      this.throwBadRequest('The sequence step was not found');
    }

    await this.assertSequencesEditable({
      authContext,
      sequenceIds: [step.sequenceId, nextSequenceId].filter(
        Boolean,
      ) as string[],
    });
  }

  async assertStepMutationAllowed({
    authContext,
    stepId,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
  }): Promise<void> {
    await this.assertStepUpdateAllowed({ authContext, stepId });
  }

  async assertSequenceUpdateAllowed({
    authContext,
    sequenceId,
    data,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    data: Partial<SequenceWorkspaceEntity>;
  }): Promise<void> {
    const [sequence] = await this.getSequences({
      authContext,
      sequenceIds: [sequenceId],
    });

    if (!sequence) {
      this.throwBadRequest('The sequence was not found');
    }

    const fieldNames = Object.keys(data);

    if (fieldNames.some((fieldName) => SEQUENCE_ENGINE_FIELDS.has(fieldName))) {
      this.throwBadRequest(
        'Sequence counters are managed by the sequence engine',
      );
    }

    if (
      (sequence.status === SEQUENCE_STATUSES.ACTIVE ||
        (await this.hasActiveEnrollments({
          authContext,
          sequenceIds: [sequenceId],
        }))) &&
      fieldNames.some((fieldName) =>
        ['senderConnectedAccountId', 'settings'].includes(fieldName),
      )
    ) {
      this.throwBadRequest('Pause the sequence before changing its settings');
    }

    if (data.status === SEQUENCE_STATUSES.ACTIVE) {
      const steps = await this.getSequenceSteps({
        authContext,
        sequenceId,
      });
      const senderConnectedAccountId =
        data.senderConnectedAccountId ?? sequence.senderConnectedAccountId;
      const hasAutomatedOutboundStep = steps.some(({ settings }) => {
        switch (settings.type) {
          case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
          case SEQUENCE_STEP_TYPES.SEND_EMAIL:
          case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
          case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
            return (
              settings.executionMode !== SEQUENCE_ACTION_EXECUTION_MODES.MANUAL
            );
          default:
            return false;
        }
      });

      if (hasAutomatedOutboundStep && !senderConnectedAccountId) {
        this.throwBadRequest('Choose a sender before activating the sequence');
      }

      if (steps.length === 0) {
        this.throwBadRequest('Add a step before activating the sequence');
      }

      if (hasAutomatedOutboundStep && senderConnectedAccountId) {
        try {
          await this.sequenceSenderService.getReadySenderOrThrow({
            connectedAccountId: senderConnectedAccountId,
            expectedUserWorkspaceId: isUserAuthContext(authContext)
              ? authContext.userWorkspaceId
              : undefined,
            workspaceId: authContext.workspace.id,
          });
        } catch (error) {
          this.throwBadRequest(
            error instanceof Error
              ? error.message
              : 'The selected sender mailbox is not ready',
          );
        }
      }
    }
  }

  async assertSequenceArchiveAllowed({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const sequence = await this.getSequenceOrThrow({
      authContext,
      sequenceId,
    });

    if (sequence.deletedAt) {
      this.throwBadRequest('The sequence is already archived');
    }
  }

  async assertSequenceDestroyAllowed({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const sequence = await this.getSequenceOrThrow({
      authContext,
      sequenceId,
    });

    if (!sequence.deletedAt) {
      this.throwBadRequest(
        'Archive the sequence before permanently deleting it',
      );
    }
  }

  async assertSequenceRestoreAllowed({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const sequence = await this.getSequenceOrThrow({
      authContext,
      sequenceId,
    });

    if (!sequence.deletedAt) {
      this.throwBadRequest('Only an archived sequence can be restored');
    }
  }

  throwBulkMutationUnsupported(objectName: string): never {
    this.throwBadRequest(`Bulk mutations are not supported for ${objectName}`);
  }

  throwEnrollmentDeletionUnsupported(): never {
    this.throwBadRequest(
      'Enrollment history cannot be deleted; remove the enrollment instead',
    );
  }

  private async assertSequencesEditable({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
  }): Promise<void> {
    const uniqueSequenceIds = [...new Set(sequenceIds)];
    const sequences = await this.getSequences({
      authContext,
      sequenceIds: uniqueSequenceIds,
    });

    if (sequences.length !== uniqueSequenceIds.length) {
      this.throwBadRequest('One or more sequences were not found');
    }

    if (
      sequences.some(({ status }) => status === SEQUENCE_STATUSES.ACTIVE) ||
      (await this.hasActiveEnrollments({
        authContext,
        sequenceIds: uniqueSequenceIds,
      }))
    ) {
      this.throwBadRequest('Pause the sequence before changing its steps');
    }
  }

  private async getSequences({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
  }): Promise<SequenceWorkspaceEntity[]> {
    if (sequenceIds.length === 0) {
      return [];
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

        return repository.find({
          where: { id: In(sequenceIds) },
          withDeleted: true,
        });
      },
      authContext,
      { lite: true },
    );
  }

  private async getSequenceOrThrow({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<SequenceWorkspaceEntity> {
    const [sequence] = await this.getSequences({
      authContext,
      sequenceIds: [sequenceId],
    });

    if (!sequence) {
      this.throwBadRequest('The sequence was not found');
    }

    return sequence;
  }

  private async getSteps({
    authContext,
    stepIds,
  }: {
    authContext: WorkspaceAuthContext;
    stepIds: string[];
  }): Promise<SequenceStepWorkspaceEntity[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceStepWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

        return repository.find({
          where: { id: In(stepIds) },
          withDeleted: true,
        });
      },
      authContext,
      { lite: true },
    );
  }

  private async getEnrollment({
    authContext,
    enrollmentId,
  }: {
    authContext: WorkspaceAuthContext;
    enrollmentId: string;
  }): Promise<SequenceEnrollmentWorkspaceEntity> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<SequenceEnrollmentWorkspaceEntity>(
            authContext.workspace.id,
            'sequenceEnrollment',
            { shouldBypassPermissionChecks: true },
          );
        const enrollment = await repository.findOne({
          where: { id: enrollmentId },
          withDeleted: true,
        });

        if (!enrollment) {
          this.throwBadRequest('The sequence enrollment was not found');
        }

        return enrollment;
      },
      authContext,
      { lite: true },
    );
  }

  private async getSequenceSteps({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<SequenceStepWorkspaceEntity[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceStepWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

        return repository.find({ where: { sequenceId } });
      },
      authContext,
      { lite: true },
    );
  }

  private async hasActiveEnrollments({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
  }): Promise<boolean> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<SequenceEnrollmentWorkspaceEntity>(
            authContext.workspace.id,
            'sequenceEnrollment',
            { shouldBypassPermissionChecks: true },
          );

        return (
          (await repository.count({
            where: {
              sequenceId: In(sequenceIds),
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            },
          })) > 0
        );
      },
      authContext,
      { lite: true },
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
