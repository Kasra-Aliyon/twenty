import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceCreateTaskStepSettings,
  type SequenceDelayStepSettings,
  type SequenceEmailStepSettings,
  type SequenceSettings,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IsNull, LessThanOrEqual } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import {
  SEQUENCE_ERROR_MESSAGE_MAX_LENGTH,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
} from 'src/modules/sequence/sequence.constants';
import {
  SequenceEnrollmentWorkspaceEntity,
  type SequenceSentEmailMetadata,
} from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import {
  isWithinSendingWindow,
  nextWindowOpen,
} from 'src/modules/sequence/utils/sequence-window.util';

@Injectable()
export class SequenceExecutorService {
  private readonly logger = new Logger(SequenceExecutorService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceEmailSenderService: SequenceEmailSenderService,
    private readonly sequenceTaskCreatorService: SequenceTaskCreatorService,
    private readonly sequenceMailboxThrottleService: SequenceMailboxThrottleService,
  ) {}

  async process({
    workspaceId,
    enrollmentId,
  }: {
    workspaceId: string;
    enrollmentId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const enrollment = await enrollmentRepository.findOne({
        where: { id: enrollmentId },
      });

      if (
        !isDefined(enrollment) ||
        enrollment.status !== SEQUENCE_ENROLLMENT_STATUSES.ACTIVE
      ) {
        return;
      }

      const sequenceRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const sequence = await sequenceRepository.findOne({
        where: { id: enrollment.sequenceId },
      });

      if (
        !isDefined(sequence) ||
        sequence.status !== SEQUENCE_STATUSES.ACTIVE
      ) {
        return;
      }

      const interruptedStepId = enrollment.lastSendAttempt?.stepId;

      if (
        isDefined(interruptedStepId) &&
        enrollment.currentStepId === interruptedStepId &&
        !isDefined(enrollment.sentEmailsByStepId?.[interruptedStepId])
      ) {
        if (
          isDefined(enrollment.nextActionAt) &&
          enrollment.nextActionAt.getTime() > Date.now()
        ) {
          return;
        }

        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: SEQUENCE_EXECUTION_ERROR.SEND_INTERRUPTED,
          stepId: interruptedStepId,
          stepPosition: enrollment.currentStepPosition,
        });

        return;
      }

      if (
        enrollment.waitingOn === SEQUENCE_WAITING_ON.TASK_DONE ||
        !isDefined(enrollment.nextActionAt) ||
        enrollment.nextActionAt.getTime() > Date.now()
      ) {
        return;
      }

      const stepRepository = await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceStepWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
      const steps = await stepRepository.find({
        where: { sequenceId: sequence.id },
        order: { position: 'ASC' },
      });
      const nextStep = steps.find(
        (step) => step.position > enrollment.currentStepPosition,
      );

      if (!isDefined(nextStep)) {
        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepPosition: enrollment.currentStepPosition,
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: new Date(),
          },
        );

        return;
      }

      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const person = await personRepository.findOne({
        where: { id: enrollment.personId },
        relations: { company: true },
      });

      if (!isDefined(person)) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_PERSON,
          stepId: nextStep.id,
          stepPosition: nextStep.position,
        });

        return;
      }

      switch (nextStep.type) {
        case SEQUENCE_STEP_TYPES.DELAY:
          if (nextStep.settings.type !== SEQUENCE_STEP_TYPES.DELAY) {
            await this.failInvalidStepSettings({
              enrollmentRepository,
              enrollment,
              step: nextStep,
            });

            return;
          }

          await this.processDelayStep({
            enrollmentRepository,
            enrollment,
            step: nextStep,
            settings: nextStep.settings,
          });

          return;
        case SEQUENCE_STEP_TYPES.CREATE_TASK:
          if (nextStep.settings.type !== SEQUENCE_STEP_TYPES.CREATE_TASK) {
            await this.failInvalidStepSettings({
              enrollmentRepository,
              enrollment,
              step: nextStep,
            });

            return;
          }

          await this.processCreateTaskStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            step: nextStep,
            settings: nextStep.settings,
          });

          return;
        case SEQUENCE_STEP_TYPES.SEND_EMAIL:
          if (enrollment.waitingOn !== SEQUENCE_WAITING_ON.EMAIL_SCHEDULED) {
            return;
          }

          if (nextStep.settings.type !== SEQUENCE_STEP_TYPES.SEND_EMAIL) {
            await this.failInvalidStepSettings({
              enrollmentRepository,
              enrollment,
              step: nextStep,
            });

            return;
          }

          await this.processSendEmailStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            steps,
            settings: nextStep.settings,
          });
      }
    }, buildSystemAuthContext(workspaceId));
  }

  private async processDelayStep({
    enrollmentRepository,
    enrollment,
    step,
    settings,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceDelayStepSettings;
  }): Promise<void> {
    const durationMilliseconds =
      (this.toNonNegativeNumber(settings.days) * 24 * 60 * 60 +
        this.toNonNegativeNumber(settings.hours) * 60 * 60 +
        this.toNonNegativeNumber(settings.minutes) * 60) *
      1000;

    await enrollmentRepository.update(
      {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: enrollment.currentStepPosition,
      },
      {
        currentStepId: step.id,
        currentStepPosition: step.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(Date.now() + durationMilliseconds),
      },
    );
  }

  private async processCreateTaskStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceCreateTaskStepSettings;
  }): Promise<void> {
    const now = new Date();
    const deadlineDays = this.toNonNegativeNumber(settings.deadlineDays ?? 0);
    const dueAt = isDefined(settings.deadlineDays)
      ? new Date(now.getTime() + deadlineDays * 24 * 60 * 60 * 1000)
      : null;
    const transition =
      settings.continueMode === 'ON_DONE'
        ? {
            waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
            nextActionAt: null,
          }
        : settings.continueMode === 'ON_DEADLINE'
          ? {
              waitingOn: SEQUENCE_WAITING_ON.TASK_DEADLINE,
              nextActionAt: dueAt ?? now,
            }
          : {
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              nextActionAt: now,
            };
    try {
      const workspaceDataSource =
        await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

      await workspaceDataSource.transaction(async (transactionManager) => {
        const workspaceTransactionManager =
          transactionManager as WorkspaceEntityManager;
        const claimResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepPosition: enrollment.currentStepPosition,
          },
          {
            currentStepId: step.id,
            currentStepPosition: step.position,
            ...transition,
          },
          workspaceTransactionManager,
        );

        if (claimResult.affected !== 1) {
          return;
        }

        await this.sequenceTaskCreatorService.createTask({
          workspaceId,
          enrollment,
          person,
          step,
          settings,
          connectedAccountId: enrollment.senderConnectedAccountId,
          dueAt,
          entityManager: workspaceTransactionManager,
        });
      });
    } catch (error) {
      const errorMessage = this.toErrorMessage(error);

      this.logger.error(
        `Failed to create task for sequence enrollment ${enrollment.id}: ${errorMessage}`,
      );
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage,
        stepId: step.id,
        stepPosition: step.position,
      });
    }
  }

  private async processSendEmailStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    sequenceSettings,
    sequenceSenderConnectedAccountId,
    step,
    steps,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    sequenceSettings: SequenceSettings;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    steps: SequenceStepWorkspaceEntity[];
    settings: SequenceEmailStepSettings;
  }): Promise<void> {
    if (person.emailOptOut) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.EMAIL_OPT_OUT,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    if (!isNonEmptyString(person.emails?.primaryEmail)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_EMAIL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    const connectedAccountId =
      enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId;

    if (!isDefined(connectedAccountId)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_CONNECTED_ACCOUNT,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    const sentEmailsByStepId = enrollment.sentEmailsByStepId ?? {};

    if (
      enrollment.lastSendAttempt?.stepId === step.id &&
      !isDefined(sentEmailsByStepId[step.id])
    ) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.SEND_INTERRUPTED,
        stepId: step.id,
        stepPosition: enrollment.currentStepPosition,
      });

      return;
    }

    const now = new Date();
    const windowEligibleAt = this.getNextEligibleSendAt({
      now,
      lastSendAt: null,
      settings: sequenceSettings,
    });

    if (windowEligibleAt.getTime() > now.getTime()) {
      await this.rescheduleEmail({
        enrollmentRepository,
        enrollment,
        nextActionAt: windowEligibleAt,
        now,
      });

      return;
    }

    const lockAcquired =
      await this.sequenceMailboxThrottleService.acquireSendLock({
        workspaceId,
        mailboxId: connectedAccountId,
      });

    if (!lockAcquired) {
      return;
    }

    try {
      const lastSendAt =
        await this.sequenceMailboxThrottleService.getLastSendAt({
          workspaceId,
          mailboxId: connectedAccountId,
          enrollmentRepository,
        });
      const sendAt = this.getNextEligibleSendAt({
        now,
        lastSendAt,
        settings: sequenceSettings,
      });

      if (sendAt.getTime() > now.getTime()) {
        await this.rescheduleEmail({
          enrollmentRepository,
          enrollment,
          nextActionAt: sendAt,
          now,
        });

        return;
      }

      const attemptedAt = now.toISOString();
      const claimResult = await enrollmentRepository.update(
        {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepPosition: enrollment.currentStepPosition,
          currentStepId: isDefined(enrollment.currentStepId)
            ? enrollment.currentStepId
            : IsNull(),
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: LessThanOrEqual(now),
        },
        {
          currentStepId: step.id,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: new Date(
            now.getTime() + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
          ),
          stopOnReply: settings.stopOnReply ?? sequenceSettings.stopOnReply,
          lastSendAttempt: {
            stepId: step.id,
            attemptedAt,
          },
        },
      );

      if (claimResult.affected !== 1) {
        return;
      }

      await this.sequenceMailboxThrottleService.setLastSendAt({
        workspaceId,
        mailboxId: connectedAccountId,
        date: now,
      });

      try {
        const sendResult = await this.sequenceEmailSenderService.send({
          workspaceId,
          enrollment,
          person,
          step,
          steps,
          settings,
          connectedAccountId,
        });
        const sentAt = new Date().toISOString();
        const updatedSentEmailsByStepId: Record<
          string,
          SequenceSentEmailMetadata
        > = {
          ...sentEmailsByStepId,
          [step.id]: {
            headerMessageId: sendResult.headerMessageId,
            threadExternalId: sendResult.threadExternalId,
            sentAt,
          },
        };

        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepPosition: enrollment.currentStepPosition,
            currentStepId: step.id,
          },
          {
            currentStepPosition: step.position,
            sentEmailsByStepId: updatedSentEmailsByStepId,
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            nextActionAt: new Date(),
          },
        );
      } catch (error) {
        const errorMessage = this.toErrorMessage(error);

        this.logger.error(
          `Failed to send email for sequence enrollment ${enrollment.id}: ${errorMessage}`,
        );
        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepPosition: enrollment.currentStepPosition,
            currentStepId: step.id,
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: new Date(),
            errorMessage,
          },
        );
      }
    } finally {
      await this.sequenceMailboxThrottleService.releaseSendLock({
        workspaceId,
        mailboxId: connectedAccountId,
      });
    }
  }

  private async rescheduleEmail({
    enrollmentRepository,
    enrollment,
    nextActionAt,
    now,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    nextActionAt: Date;
    now: Date;
  }): Promise<void> {
    await enrollmentRepository.update(
      {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: enrollment.currentStepPosition,
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: LessThanOrEqual(now),
      },
      { nextActionAt },
    );
  }

  private getNextEligibleSendAt({
    now,
    lastSendAt,
    settings,
  }: {
    now: Date;
    lastSendAt: Date | null;
    settings: SequenceSettings;
  }): Date {
    const staggerMilliseconds = settings.staggerMinutes * 60 * 1000;
    const candidate = new Date(
      Math.max(
        now.getTime(),
        (lastSendAt?.getTime() ?? now.getTime() - staggerMilliseconds) +
          staggerMilliseconds,
      ),
    );

    return isWithinSendingWindow(candidate, settings)
      ? candidate
      : nextWindowOpen(candidate, settings);
  }

  private async failInvalidStepSettings({
    enrollmentRepository,
    enrollment,
    step,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
  }): Promise<void> {
    await this.failEnrollment({
      enrollmentRepository,
      enrollment,
      errorMessage: SEQUENCE_EXECUTION_ERROR.INVALID_STEP_SETTINGS,
      stepId: step.id,
      stepPosition: step.position,
    });
  }

  private async failEnrollment({
    enrollmentRepository,
    enrollment,
    errorMessage,
    stepId,
    stepPosition,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    errorMessage: string;
    stepId: string;
    stepPosition: number;
  }): Promise<void> {
    await enrollmentRepository.update(
      {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: enrollment.currentStepPosition,
      },
      {
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        currentStepId: stepId,
        currentStepPosition: stepPosition,
        waitingOn: null,
        nextActionAt: null,
        endedAt: new Date(),
        errorMessage: errorMessage.slice(0, SEQUENCE_ERROR_MESSAGE_MAX_LENGTH),
      },
    );
  }

  private toNonNegativeNumber(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  private toErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return message.slice(0, SEQUENCE_ERROR_MESSAGE_MAX_LENGTH);
  }
}
