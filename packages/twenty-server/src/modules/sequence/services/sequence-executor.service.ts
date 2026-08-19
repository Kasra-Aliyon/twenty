import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  MessageParticipantRole,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_BRANCHES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_WAITING_ON,
  TASK_PRIORITIES,
  type SequenceActionExecutionSettings,
  type SequenceConditionBranch,
  type SequenceConditionStepSettings,
  type SequenceCreateTaskStepSettings,
  type SequenceConnectionRequestStepSettings,
  type SequenceDelayStepSettings,
  type SequenceEmailStepSettings,
  type SequenceLinkedInMessageStepSettings,
  type SequenceSettings,
  type SequenceWaitingOn,
  type SequenceWithdrawConnectionRequestStepSettings,
} from 'twenty-shared/types';
import { isDefined, renderSpintax } from 'twenty-shared/utils';
import {
  Equal,
  ILike,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import {
  ApolloEnrichmentError,
  ApolloEnrichmentProviderNotStartedError,
  ApolloEnrichmentProviderRejectedError,
} from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { LinkedinInvitationWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-invitation.workspace-entity';
import { LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { normalizeLinkedinHandle } from 'src/modules/linkedin/utils/linkedin-identity-matching.util';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import {
  SequenceEmailPreparationPermanentError,
  SequenceEmailSenderService,
} from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  SequenceSenderNotReadyError,
  SequenceSenderService,
  SequenceSenderUnavailableError,
} from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import {
  LINKEDIN_CONNECTION_NOTE_MAX_LENGTH,
  LINKEDIN_CONNECTION_OBSERVATION_MAX_AGE_MS,
  LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH,
  SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
  SEQUENCE_APOLLO_ENRICHMENT_TIMEOUT_MILLISECONDS,
  SEQUENCE_EMAIL_PRE_PROVIDER_FAILURE_LIMIT,
  SEQUENCE_ERROR_MESSAGE_MAX_LENGTH,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
  SEQUENCE_SEND_ATTEMPT_HEARTBEAT_MILLISECONDS,
  SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
  SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
} from 'src/modules/sequence/sequence.constants';
import {
  SequenceEnrollmentWorkspaceEntity,
  type SequenceLastSendAttempt,
  type SequenceSentEmailMetadata,
} from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { findNextSequenceStep } from 'src/modules/sequence/utils/find-next-sequence-step.util';
import { hasLiveSequenceEmailSendLease } from 'src/modules/sequence/utils/has-live-sequence-email-send-lease.util';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import { renderSequenceTemplate } from 'src/modules/sequence/utils/render-sequence-template.util';
import { resolveSequenceEmailWindowSettings } from 'src/modules/sequence/utils/resolve-sequence-email-window-settings.util';
import {
  isWithinSendingWindow,
  nextWindowOpen,
} from 'src/modules/sequence/utils/sequence-window.util';

class SequencePauseRetryConflictError extends Error {
  constructor() {
    super('Sequence pause retry was already handled or enrollment changed');
  }
}

class SequenceEmailClaimLostError extends Error {
  constructor() {
    super('Sequence email claim changed before the provider could start');
  }
}

class SequenceApolloProviderStartCancelledError extends Error {
  constructor() {
    super('Apollo enrichment became unnecessary or lost its durable claim');
  }
}

const SEQUENCE_EMAIL_METADATA_RETRY_MAX_DELAY_MILLISECONDS = 30 * 1000;
const SEQUENCE_EMAIL_METADATA_RETRY_LIMIT = 5;

@Injectable()
export class SequenceExecutorService {
  private readonly logger = new Logger(SequenceExecutorService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly workspaceEventEmitter: WorkspaceEventEmitter,
    private readonly sequenceEmailReplyReconciliationService: SequenceEmailReplyReconciliationService,
    private readonly sequenceLinkedinReplyListener: SequenceLinkedinReplyListener,
    private readonly sequenceEmailSenderService: SequenceEmailSenderService,
    private readonly sequenceTaskCreatorService: SequenceTaskCreatorService,
    private readonly sequenceMailboxThrottleService: SequenceMailboxThrottleService,
    private readonly sequenceLinkedinThrottleService: SequenceLinkedinThrottleService,
    private readonly sequenceQueueService: SequenceQueueService,
    private readonly sequenceSenderService: SequenceSenderService,
    private readonly sequenceVariableService: SequenceVariableService,
    private readonly apolloEnrichmentService: ApolloEnrichmentService,
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
      const enqueueContinuationIfDue = async () =>
        this.enqueueContinuationIfDue({
          workspaceId,
          enrollmentId,
          enrollmentRepository,
        });
      const enrollment = await enrollmentRepository.findOne({
        where: { id: enrollmentId },
      });

      if (!isDefined(enrollment)) {
        return;
      }

      if (
        await this.recoverDeliveredEmailSend({
          enrollmentRepository,
          enrollment,
        })
      ) {
        await enqueueContinuationIfDue();

        return;
      }

      if (enrollment.status !== SEQUENCE_ENROLLMENT_STATUSES.ACTIVE) {
        const terminalSendAttempt = enrollment.lastSendAttempt;

        if (
          isDefined(terminalSendAttempt?.dailyReservation) &&
          !isDefined(terminalSendAttempt.preProviderFailure) &&
          (!isDefined(terminalSendAttempt.providerStartedAt) ||
            isDefined(terminalSendAttempt.reservationReleasePendingAt)) &&
          !isDefined(
            enrollment.sentEmailsByStepId?.[terminalSendAttempt.stepId],
          )
        ) {
          await this.releaseReservationAndClearTerminalEmailClaim({
            workspaceId,
            enrollmentRepository,
            enrollment,
            sendAttempt: terminalSendAttempt,
          });
        }

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

      const interruptedSendAttempt = enrollment.lastSendAttempt;
      const interruptedStepId = interruptedSendAttempt?.stepId;
      const hasUnattributedEmailClaim =
        isDefined(interruptedSendAttempt) &&
        isDefined(interruptedStepId) &&
        !isDefined(interruptedSendAttempt.preProviderFailure) &&
        enrollment.currentStepId === interruptedStepId &&
        !isDefined(enrollment.sentEmailsByStepId?.[interruptedStepId]);

      // A paused or archived sequence cannot cross the provider boundary, so
      // release a still-unstarted mailbox reservation immediately. Waiting for
      // the normal lease here would let a paused sequence consume another
      // active sequence's daily mailbox capacity.
      if (
        (!isDefined(sequence) ||
          sequence.status !== SEQUENCE_STATUSES.ACTIVE) &&
        hasUnattributedEmailClaim &&
        (!isDefined(interruptedSendAttempt.providerStartedAt) ||
          isDefined(interruptedSendAttempt.reservationReleasePendingAt)) &&
        isDefined(interruptedSendAttempt.previousCursor)
      ) {
        await this.releaseReservationAndRestoreUnstartedEmailClaim({
          workspaceId,
          enrollmentRepository,
          enrollment,
          sendAttempt: interruptedSendAttempt,
          allowProviderStartedAttempt: isDefined(
            interruptedSendAttempt.providerStartedAt,
          ),
        });

        return;
      }

      if (
        !isDefined(sequence) ||
        sequence.status !== SEQUENCE_STATUSES.ACTIVE
      ) {
        return;
      }

      const stopForReplyAndReleaseReservation = async (): Promise<void> => {
        if (
          hasUnattributedEmailClaim &&
          (!isDefined(interruptedSendAttempt.providerStartedAt) ||
            isDefined(interruptedSendAttempt.reservationReleasePendingAt))
        ) {
          await this.releaseReservationAndClearTerminalEmailClaim({
            workspaceId,
            enrollmentRepository,
            enrollment: {
              ...enrollment,
              status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
            },
            sendAttempt: interruptedSendAttempt,
          });
        }
      };

      if (
        await this.sequenceEmailReplyReconciliationService.reconcileBeforeEnrollmentProgress(
          {
            workspaceId,
            enrollment,
            enrollmentRepository,
          },
        )
      ) {
        await stopForReplyAndReleaseReservation();

        return;
      }

      if (
        await this.sequenceLinkedinReplyListener.reconcileEnrollmentBeforeProviderStart(
          {
            sequenceEnrollmentId: enrollment.id,
            workspaceId,
          },
        )
      ) {
        await stopForReplyAndReleaseReservation();

        return;
      }

      if (hasUnattributedEmailClaim) {
        if (
          !isDefined(interruptedSendAttempt.reservationReleasePendingAt) &&
          hasLiveSequenceEmailSendLease({ enrollment, now: new Date() })
        ) {
          return;
        }

        if (
          (!isDefined(interruptedSendAttempt.providerStartedAt) ||
            isDefined(interruptedSendAttempt.reservationReleasePendingAt)) &&
          isDefined(interruptedSendAttempt.previousCursor)
        ) {
          const restored =
            await this.releaseReservationAndRestoreUnstartedEmailClaim({
              workspaceId,
              enrollmentRepository,
              enrollment,
              sendAttempt: interruptedSendAttempt,
              allowProviderStartedAttempt: isDefined(
                interruptedSendAttempt.providerStartedAt,
              ),
            });

          if (restored) {
            await this.sequenceQueueService.enqueueProcess({
              workspaceId,
              enrollmentId: enrollment.id,
            });
          }

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
      const currentStep = steps.find(
        ({ id }) => id === enrollment.currentStepId,
      );
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      let person: PersonWorkspaceEntity | null = null;
      let conditionOutcome: SequenceConditionBranch | undefined;

      if (currentStep?.settings.type === SEQUENCE_STEP_TYPES.CONDITION) {
        person = await personRepository.findOne({
          where: { id: enrollment.personId },
          relations: { company: true },
        });

        if (!isDefined(person)) {
          await this.failEnrollment({
            enrollmentRepository,
            enrollment,
            errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_PERSON,
            stepId: currentStep.id,
            stepPosition: currentStep.position,
          });

          return;
        }

        try {
          conditionOutcome = (await this.evaluateCondition({
            workspaceId,
            enrollment,
            person,
            senderConnectedAccountId:
              enrollment.senderConnectedAccountId ??
              sequence.senderConnectedAccountId,
            settings: currentStep.settings,
          }))
            ? SEQUENCE_CONDITION_BRANCHES.YES
            : SEQUENCE_CONDITION_BRANCHES.NO;
        } catch (error) {
          if (error instanceof SequenceSenderUnavailableError) {
            await this.failEnrollment({
              enrollmentRepository,
              enrollment,
              errorMessage: this.toErrorMessage(error),
              stepId: currentStep.id,
              stepPosition: currentStep.position,
            });

            return;
          }

          throw error;
        }
      }

      const pausedLinkedinRetryActionId = isDefined(currentStep)
        ? await this.getPausedLinkedinRetryActionId({
            workspaceId,
            enrollmentId: enrollment.id,
            step: currentStep,
          })
        : null;
      const isWaitingForApolloEnrichment =
        [
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        ].some((waitingOn) => enrollment.waitingOn === waitingOn) &&
        currentStep?.settings.type === SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER;
      const nextStep =
        isDefined(pausedLinkedinRetryActionId) || isWaitingForApolloEnrichment
          ? currentStep
          : findNextSequenceStep({
              steps,
              currentStepId: enrollment.currentStepId,
              currentStepPosition: enrollment.currentStepPosition,
              conditionOutcome,
            });

      if (!isDefined(nextStep)) {
        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepPosition: enrollment.currentStepPosition,
            currentStepId: isDefined(enrollment.currentStepId)
              ? enrollment.currentStepId
              : IsNull(),
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

      if (!isDefined(person)) {
        person = await personRepository.findOne({
          where: { id: enrollment.personId },
          relations: { company: true },
        });
      }

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

      switch (nextStep.settings.type) {
        case SEQUENCE_STEP_TYPES.DELAY:
          await this.processDelayStep({
            enrollmentRepository,
            enrollment,
            step: nextStep,
            settings: nextStep.settings,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.CREATE_TASK:
          await this.processCreateTaskStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            step: nextStep,
            settings: nextStep.settings,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
          if (this.isManualExecution(nextStep.settings)) {
            await this.processManualConnectionRequestStep({
              workspaceId,
              enrollmentRepository,
              enrollment,
              person,
              sequenceSenderConnectedAccountId:
                sequence.senderConnectedAccountId,
              step: nextStep,
              settings: nextStep.settings,
            });
            await enqueueContinuationIfDue();

            return;
          }

          await this.processConnectionRequestStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            pausedLinkedinRetryActionId,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            settings: nextStep.settings,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
          if (this.isManualExecution(nextStep.settings)) {
            await this.processManualLinkedInMessageStep({
              workspaceId,
              enrollmentRepository,
              enrollment,
              person,
              sequenceSenderConnectedAccountId:
                sequence.senderConnectedAccountId,
              step: nextStep,
              settings: nextStep.settings,
            });
            await enqueueContinuationIfDue();

            return;
          }

          await this.processLinkedInMessageStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            pausedLinkedinRetryActionId,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            settings: nextStep.settings,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
          if (this.isManualExecution(nextStep.settings)) {
            await this.processManualWithdrawConnectionRequestStep({
              workspaceId,
              enrollmentRepository,
              enrollment,
              person,
              sequenceSenderConnectedAccountId:
                sequence.senderConnectedAccountId,
              step: nextStep,
              settings: nextStep.settings,
            });
            await enqueueContinuationIfDue();

            return;
          }

          await this.processWithdrawConnectionRequestStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            pausedLinkedinRetryActionId,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            settings: nextStep.settings,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.SEND_EMAIL:
          if (this.isManualExecution(nextStep.settings)) {
            await this.processManualEmailStep({
              workspaceId,
              enrollmentRepository,
              enrollment,
              person,
              step: nextStep,
              settings: nextStep.settings,
            });
            await enqueueContinuationIfDue();

            return;
          }

          if (enrollment.waitingOn !== SEQUENCE_WAITING_ON.EMAIL_SCHEDULED) {
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
            settings: nextStep.settings,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.CONDITION:
          await this.processConditionStep({
            enrollmentRepository,
            enrollment,
            step: nextStep,
          });
          await enqueueContinuationIfDue();

          return;
        case SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER:
          if (this.isManualExecution(nextStep.settings)) {
            await this.processManualActionStep({
              workspaceId,
              enrollmentRepository,
              enrollment,
              person,
              step: nextStep,
              settings: nextStep.settings,
              taskType: SEQUENCE_TASK_TYPES.CUSTOM,
              defaultTitle: 'Find a phone number for {{ fullName }}',
            });
            await enqueueContinuationIfDue();

            return;
          }

          await this.processEnrichPhoneNumberStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            step: nextStep,
          });
          await enqueueContinuationIfDue();
      }
    }, buildSystemAuthContext(workspaceId));
  }

  private async enqueueContinuationIfDue({
    workspaceId,
    enrollmentId,
    enrollmentRepository,
  }: {
    workspaceId: string;
    enrollmentId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<void> {
    const updatedEnrollment = await enrollmentRepository.findOne({
      where: { id: enrollmentId },
      select: ['id', 'nextActionAt', 'status', 'waitingOn'],
    });

    if (
      updatedEnrollment?.status !== SEQUENCE_ENROLLMENT_STATUSES.ACTIVE ||
      updatedEnrollment.waitingOn !== SEQUENCE_WAITING_ON.DELAY ||
      !isDefined(updatedEnrollment.nextActionAt) ||
      updatedEnrollment.nextActionAt.getTime() > Date.now()
    ) {
      return;
    }

    await this.sequenceQueueService.enqueueProcess({
      workspaceId,
      enrollmentId,
    });
  }

  private async getPausedLinkedinRetryActionId({
    workspaceId,
    enrollmentId,
    step,
  }: {
    workspaceId: string;
    enrollmentId: string;
    step: SequenceStepWorkspaceEntity;
  }): Promise<string | null> {
    if (
      step.settings.type !== SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST &&
      step.settings.type !== SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE &&
      step.settings.type !== SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST
    ) {
      return null;
    }

    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const latestAction = await linkedinActionRepository.findOne({
      where: {
        sequenceEnrollmentId: enrollmentId,
        sequenceStepId: step.id,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      select: ['errorMessage', 'id', 'status'],
    });

    return latestAction?.status === LINKEDIN_ACTION_STATUSES.CANCELLED &&
      latestAction.errorMessage === SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR
      ? latestAction.id
      : null;
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
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        currentStepPosition: enrollment.currentStepPosition,
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
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
            currentStepId: isDefined(enrollment.currentStepId)
              ? enrollment.currentStepId
              : IsNull(),
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
      throw error;
    }
  }

  private async processManualActionStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    step,
    settings,
    taskType,
    defaultTitle,
    defaultNotes = '',
    deadlineDays = null,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceActionExecutionSettings;
    taskType: SequenceCreateTaskStepSettings['taskType'];
    defaultTitle: string;
    defaultNotes?: string;
    deadlineDays?: number | null;
  }): Promise<void> {
    await this.processCreateTaskStep({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      step,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType,
        titleTemplate: isNonEmptyString(settings.manualTaskTitle)
          ? settings.manualTaskTitle
          : defaultTitle,
        notesTemplate: isNonEmptyString(settings.manualTaskDescription)
          ? settings.manualTaskDescription
          : defaultNotes,
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays,
      },
    });
  }

  private async processManualEmailStep({
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

    const spintaxSeed = `${enrollment.id}:${step.id}:control`;
    const subject = renderSpintax(settings.subject, `${spintaxSeed}:subject`);
    const bodyHtml = renderSpintax(settings.bodyHtml, `${spintaxSeed}:body`);

    await this.processManualActionStep({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      step,
      settings,
      taskType: SEQUENCE_TASK_TYPES.EMAIL,
      defaultTitle: 'Send email to {{ fullName }}',
      defaultNotes: `Recipient: {{ email }}\n\nSubject: ${subject}\n\nDraft:\n${bodyHtml}`,
    });
  }

  private async processManualConnectionRequestStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceConnectionRequestStepSettings;
  }): Promise<void> {
    if (!this.hasLinkedinProfileUrl(person)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    try {
      const senderConnectedAccountId =
        enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId;
      const ownerWorkspaceMemberId = await this.getSenderOwnerWorkspaceMemberId(
        {
          workspaceId,
          senderConnectedAccountId,
        },
      );
      const [hasOutstandingRequest, isConnected] = await Promise.all([
        this.hasOutstandingConnectionRequest({
          workspaceId,
          person,
          ownerWorkspaceMemberId,
        }),
        this.isPersonConnectedToSender({
          workspaceId,
          person,
          senderConnectedAccountId,
        }),
      ]);

      // A human cannot send another invitation in either state. Avoid creating
      // a task whose only possible outcome is to discover it was unnecessary.
      if (hasOutstandingRequest || isConnected) {
        await this.advanceEnrollmentStep({
          enrollmentRepository,
          enrollment,
          step,
        });

        return;
      }
    } catch (error) {
      if (error instanceof SequenceSenderUnavailableError) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: this.toErrorMessage(error),
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }

    const noteTemplate = isNonEmptyString(settings.noteTemplate)
      ? `\n\nConnection note:\n${settings.noteTemplate}`
      : '';

    await this.processManualActionStep({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      step,
      settings,
      taskType: SEQUENCE_TASK_TYPES.LINKEDIN_CONNECTION,
      defaultTitle: 'Send LinkedIn connection request to {{ fullName }}',
      defaultNotes: `LinkedIn profile: {{ linkedinUrl }}${noteTemplate}`,
    });
  }

  private async processManualLinkedInMessageStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceLinkedInMessageStepSettings;
  }): Promise<void> {
    if (!this.hasLinkedinProfileUrl(person)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    try {
      const isConnected = await this.isPersonConnectedToSender({
        workspaceId,
        person,
        senderConnectedAccountId:
          enrollment.senderConnectedAccountId ??
          sequenceSenderConnectedAccountId,
      });

      if (!isConnected) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_NOT_CONNECTED,
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }
    } catch (error) {
      if (error instanceof SequenceSenderUnavailableError) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: this.toErrorMessage(error),
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }

    await this.processManualActionStep({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      step,
      settings,
      taskType: SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE,
      defaultTitle: 'Send LinkedIn message to {{ fullName }}',
      defaultNotes:
        'LinkedIn profile: {{ linkedinUrl }}\n\nMessage:\n' +
        settings.messageTemplate,
    });
  }

  private async processManualWithdrawConnectionRequestStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceWithdrawConnectionRequestStepSettings;
  }): Promise<void> {
    if (!this.hasLinkedinProfileUrl(person)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    try {
      const senderConnectedAccountId =
        enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId;
      const ownerWorkspaceMemberId = await this.getSenderOwnerWorkspaceMemberId(
        {
          workspaceId,
          senderConnectedAccountId,
        },
      );
      const [isConnected, hasOutstandingRequest] = await Promise.all([
        this.isPersonConnectedToSender({
          workspaceId,
          person,
          senderConnectedAccountId,
        }),
        this.hasOutstandingConnectionRequest({
          workspaceId,
          person,
          ownerWorkspaceMemberId,
        }),
      ]);

      if (isConnected || !hasOutstandingRequest) {
        await this.advanceEnrollmentStep({
          enrollmentRepository,
          enrollment,
          step,
        });

        return;
      }
    } catch (error) {
      if (error instanceof SequenceSenderUnavailableError) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: this.toErrorMessage(error),
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }

    await this.processManualActionStep({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      step,
      settings,
      taskType: SEQUENCE_TASK_TYPES.CUSTOM,
      defaultTitle: 'Withdraw LinkedIn invitation for {{ fullName }}',
      defaultNotes:
        'LinkedIn profile: {{ linkedinUrl }}\n\nConfirm the invitation is still pending before withdrawing it.',
      deadlineDays:
        this.toNonNegativeNumber(settings.withdrawAfterDays) +
        this.toNonNegativeNumber(settings.withdrawAfterHours) / 24,
    });
  }

  private async processConditionStep({
    enrollmentRepository,
    enrollment,
    step,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
  }): Promise<void> {
    await this.advanceEnrollmentStep({
      enrollmentRepository,
      enrollment,
      step,
    });
  }

  private async evaluateCondition({
    workspaceId,
    enrollment,
    person,
    senderConnectedAccountId,
    settings,
  }: {
    workspaceId: string;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    senderConnectedAccountId: string | null;
    settings: SequenceConditionStepSettings;
  }): Promise<boolean> {
    const outcome = await this.evaluateRawCondition({
      workspaceId,
      enrollment,
      person,
      senderConnectedAccountId,
      settings,
    });

    // `expected` lets a step assert the negative ("is not in my network").
    // It defaults to true so existing steps keep their current meaning.
    return outcome === (settings.expected ?? true);
  }

  private async evaluateRawCondition({
    workspaceId,
    enrollment,
    person,
    senderConnectedAccountId,
    settings,
  }: {
    workspaceId: string;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    senderConnectedAccountId: string | null;
    settings: SequenceConditionStepSettings;
  }): Promise<boolean> {
    switch (settings.condition) {
      case SEQUENCE_CONDITION_TYPES.IS_IN_LINKEDIN_NETWORK: {
        return this.isPersonConnectedToSender({
          workspaceId,
          person,
          senderConnectedAccountId,
        });
      }
      case SEQUENCE_CONDITION_TYPES.ACCEPTED_LINKEDIN_INVITE: {
        // Being connected is not the same as having accepted an invitation we
        // sent: a contact who was already a connection before the sequence ran
        // would otherwise satisfy this condition and skip the outreach branch.
        const ownerWorkspaceMemberId =
          await this.getSenderOwnerWorkspaceMemberId({
            workspaceId,
            senderConnectedAccountId,
          });
        const [isConnected, wasInvitationSent] = await Promise.all([
          this.isPersonConnectedToSender({
            workspaceId,
            person,
            senderConnectedAccountId,
          }),
          this.wasLinkedinInvitationSent({
            workspaceId,
            person,
            ownerWorkspaceMemberId,
          }),
        ]);

        return isConnected && wasInvitationSent;
      }
      case SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS:
        return isNonEmptyString(person.emails?.primaryEmail);
      case SEQUENCE_CONDITION_TYPES.HAS_LINKEDIN_URL:
        return this.hasLinkedinProfileUrl(person);
      case SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER:
        return isNonEmptyString(person.phones?.primaryPhoneNumber?.trim());
      case SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE: {
        const ownerWorkspaceMemberId =
          await this.getSenderOwnerWorkspaceMemberId({
            workspaceId,
            senderConnectedAccountId,
          });
        const linkedinActionRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            LinkedinActionWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const latestCompletedOutboundAction =
          await linkedinActionRepository.findOne({
            where: {
              personId: person.id,
              ownerWorkspaceMemberId,
              sequenceEnrollmentId: enrollment.id,
              type: In([
                LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
                LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
              ]),
              status: LINKEDIN_ACTION_STATUSES.COMPLETED,
              executedAt: Not(IsNull()),
            },
            order: { executedAt: 'DESC' },
          });
        const outboundExecutedAt = latestCompletedOutboundAction?.executedAt;

        // A reply from an older conversation must not select the Yes branch
        // for a new enrollment that has not sent anything yet.
        if (!isDefined(outboundExecutedAt)) {
          return false;
        }

        const participantRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            LinkedinThreadParticipantWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const participants = await participantRepository.find({
          where: {
            personId: person.id,
            isSelf: false,
            ownerWorkspaceMemberId,
          },
          select: ['linkedinUrn', 'threadId'],
        });
        const messageWhere = participants.flatMap(({ linkedinUrn, threadId }) =>
          isNonEmptyString(linkedinUrn)
            ? [
                {
                  direction: 'INBOUND' as const,
                  ownerWorkspaceMemberId,
                  senderLinkedinUrn: linkedinUrn,
                  threadId,
                  deliveredAt: MoreThanOrEqual(outboundExecutedAt),
                },
              ]
            : [],
        );
        const threadIds = [
          ...new Set(participants.map(({ threadId }) => threadId)),
        ];

        if (threadIds.length === 0) {
          return false;
        }

        const messageRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            LinkedinMessageWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        // A confirmed receipt is the direct signal. A reply remains conclusive
        // when LinkedIn withholds receipts because of privacy or message type.
        return (
          (await messageRepository.count({
            where: [
              {
                direction: 'OUTBOUND',
                ownerWorkspaceMemberId,
                threadId: In(threadIds),
                deliveredAt: MoreThanOrEqual(outboundExecutedAt),
                recipientReadAt: Not(IsNull()),
              },
              ...messageWhere,
            ],
          })) > 0
        );
      }
    }
  }

  private async processEnrichPhoneNumberStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    step,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
  }): Promise<void> {
    const currentApolloWaitingOn = [
      SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
      SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
      SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
    ].find((waitingOn) => enrollment.waitingOn === waitingOn);

    if (isNonEmptyString(person.phones?.primaryPhoneNumber?.trim())) {
      await this.advanceEnrollmentStep({
        enrollmentRepository,
        enrollment,
        expectedWaitingOn: currentApolloWaitingOn ?? SEQUENCE_WAITING_ON.DELAY,
        step,
      });

      return;
    }

    // A provider-started wait is deliberately single-shot. If its callback
    // window elapsed without a phone, retrying could buy the same reveal twice.
    if (currentApolloWaitingOn === SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT) {
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const sequenceRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const workspaceDataSource =
        await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

      await workspaceDataSource.transaction(async (transactionManager) => {
        const workspaceTransactionManager =
          transactionManager as WorkspaceEntityManager;
        const activeSequence = await sequenceRepository.findOne(
          {
            where: {
              id: enrollment.sequenceId,
              status: SEQUENCE_STATUSES.ACTIVE,
            },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(activeSequence)) {
          return;
        }

        const committedPerson = await personRepository.findOne(
          {
            where: { id: person.id },
            select: ['id', 'phones'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );
        const criteria = {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
          currentStepId: step.id,
          currentStepPosition: step.position,
          nextActionAt: isDefined(enrollment.nextActionAt)
            ? Equal(enrollment.nextActionAt)
            : IsNull(),
        };

        if (
          isDefined(committedPerson) &&
          isNonEmptyString(committedPerson.phones?.primaryPhoneNumber?.trim())
        ) {
          await enrollmentRepository.update(
            criteria,
            {
              currentStepId: step.id,
              currentStepPosition: step.position,
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              nextActionAt: new Date(),
            },
            workspaceTransactionManager,
          );

          return;
        }

        await enrollmentRepository.update(
          criteria,
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: new Date(),
            errorMessage: SEQUENCE_EXECUTION_ERROR.PHONE_ENRICHMENT_NOT_FOUND,
          },
          workspaceTransactionManager,
        );
      });

      return;
    }

    // A worker that died before Apollo's HTTP boundary leaves only a short
    // claim/join lease. Restore it instead of treating an unspent request as a
    // lost callback. The normal continuation queue will retry this step.
    if (isDefined(currentApolloWaitingOn)) {
      await enrollmentRepository.update(
        {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: currentApolloWaitingOn,
          currentStepId: step.id,
          currentStepPosition: step.position,
          nextActionAt: isDefined(enrollment.nextActionAt)
            ? Equal(enrollment.nextActionAt)
            : IsNull(),
        },
        {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(),
        },
      );

      return;
    }

    const personRepository = await this.globalWorkspaceOrmManager.getRepository(
      workspaceId,
      PersonWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
    const claimExpiresAt = new Date(
      Date.now() + SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
    );
    const liveApolloWaitingStates = [
      SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
      SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
      SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
    ];
    const claimOutcome = await workspaceDataSource.transaction(
      async (transactionManager) => {
        const workspaceTransactionManager =
          transactionManager as WorkspaceEntityManager;
        const activeSequence = await sequenceRepository.findOne(
          {
            where: {
              id: enrollment.sequenceId,
              status: SEQUENCE_STATUSES.ACTIVE,
            },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(activeSequence)) {
          return { kind: 'SEQUENCE_INACTIVE' as const };
        }

        const lockedPerson = await personRepository.findOne(
          {
            where: { id: person.id },
            select: ['id', 'phones'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(lockedPerson)) {
          return { kind: 'PERSON_MISSING' as const };
        }

        if (isNonEmptyString(lockedPerson.phones?.primaryPhoneNumber?.trim())) {
          return { kind: 'PHONE_PRESENT' as const };
        }

        const existingRequestEnrollment = await enrollmentRepository.findOne(
          {
            where: {
              id: Not(enrollment.id),
              personId: person.id,
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
              waitingOn: In(liveApolloWaitingStates),
              nextActionAt: MoreThan(new Date()),
            },
            select: ['id', 'nextActionAt', 'waitingOn'],
            order: { nextActionAt: 'DESC' },
          },
          workspaceTransactionManager,
        );
        const joinsStartedRequest =
          existingRequestEnrollment?.waitingOn ===
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT;
        const nextWaitingOn = isDefined(existingRequestEnrollment)
          ? joinsStartedRequest
            ? SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT
            : SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED
          : SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED;
        const cohortExpiresAt =
          existingRequestEnrollment?.nextActionAt ?? claimExpiresAt;
        const claimResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            currentStepPosition: enrollment.currentStepPosition,
            currentStepId: isDefined(enrollment.currentStepId)
              ? enrollment.currentStepId
              : IsNull(),
          },
          {
            currentStepId: step.id,
            currentStepPosition: step.position,
            waitingOn: nextWaitingOn,
            nextActionAt: cohortExpiresAt,
          },
          workspaceTransactionManager,
        );

        if (claimResult.affected !== 1) {
          return { kind: 'CLAIM_LOST' as const };
        }

        if (isDefined(existingRequestEnrollment)) {
          return {
            kind: joinsStartedRequest
              ? ('JOINED_STARTED' as const)
              : ('JOINED_CLAIM' as const),
          };
        }

        return { kind: 'OWNER' as const };
      },
    );

    if (
      claimOutcome.kind === 'CLAIM_LOST' ||
      claimOutcome.kind === 'SEQUENCE_INACTIVE'
    ) {
      return;
    }

    if (claimOutcome.kind === 'PERSON_MISSING') {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_PERSON,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    if (claimOutcome.kind === 'PHONE_PRESENT') {
      await this.advanceEnrollmentStep({
        enrollmentRepository,
        enrollment,
        step,
      });

      return;
    }

    if (
      claimOutcome.kind === 'JOINED_CLAIM' ||
      claimOutcome.kind === 'JOINED_STARTED'
    ) {
      return;
    }

    const hasPersistedPhoneNumber = async (): Promise<boolean> => {
      const latestPerson = await personRepository.findOne({
        where: { id: person.id },
      });

      return (
        isDefined(latestPerson) &&
        isNonEmptyString(latestPerson.phones?.primaryPhoneNumber?.trim())
      );
    };
    const providerAttempt: {
      startedAt: Date | null;
      timeoutAt: Date | null;
    } = {
      startedAt: null,
      timeoutAt: null,
    };
    const transitionCohort = async ({
      expectedWaitingOn,
      expectedExpiresAt,
      values,
    }: {
      expectedWaitingOn:
        | typeof SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED
        | typeof SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED
        | typeof SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT
        | Array<
            | typeof SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED
            | typeof SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED
            | typeof SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT
          >;
      expectedExpiresAt: Date;
      values: Partial<SequenceEnrollmentWorkspaceEntity>;
    }): Promise<void> => {
      await workspaceDataSource.transaction(async (transactionManager) => {
        const workspaceTransactionManager =
          transactionManager as WorkspaceEntityManager;

        await personRepository.findOne(
          {
            where: { id: person.id },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );
        await enrollmentRepository.update(
          {
            personId: person.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: Array.isArray(expectedWaitingOn)
              ? In(expectedWaitingOn)
              : expectedWaitingOn,
            nextActionAt: Equal(expectedExpiresAt),
          },
          values,
          workspaceTransactionManager,
        );
      });
    };
    const resolveCohortWithPhone = async (): Promise<void> => {
      const expectedExpiresAt = providerAttempt.timeoutAt ?? claimExpiresAt;

      await transitionCohort({
        expectedWaitingOn: providerAttempt.startedAt
          ? SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT
          : [
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
            ],
        expectedExpiresAt,
        values: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(),
        },
      });
    };
    const failCohort = async (errorMessage: string): Promise<void> => {
      const expectedExpiresAt = providerAttempt.timeoutAt ?? claimExpiresAt;

      await transitionCohort({
        expectedWaitingOn: providerAttempt.startedAt
          ? SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT
          : [
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
            ],
        expectedExpiresAt,
        values: {
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
          errorMessage,
          waitingOn: null,
          nextActionAt: null,
          endedAt: new Date(),
        },
      });
    };
    const releaseUnstartedCohort = async (): Promise<void> => {
      await transitionCohort({
        expectedWaitingOn: [
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
        ],
        expectedExpiresAt: claimExpiresAt,
        values: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(),
        },
      });
    };

    let result: Awaited<ReturnType<ApolloEnrichmentService['enrichPerson']>>;

    try {
      result = await this.apolloEnrichmentService.enrichPerson({
        workspaceId,
        personId: person.id,
        mode: 'phone',
        onProviderStart: async () => {
          const startedAt = new Date();
          const timeoutAt = new Date(
            startedAt.getTime() +
              SEQUENCE_APOLLO_ENRICHMENT_TIMEOUT_MILLISECONDS,
          );

          try {
            const startOutcome = await workspaceDataSource.transaction(
              async (transactionManager) => {
                const workspaceTransactionManager =
                  transactionManager as WorkspaceEntityManager;
                const activeSequence = await sequenceRepository.findOne(
                  {
                    where: {
                      id: enrollment.sequenceId,
                      status: SEQUENCE_STATUSES.ACTIVE,
                    },
                    select: ['id'],
                    lock: { mode: 'pessimistic_write' },
                  },
                  workspaceTransactionManager,
                );

                if (!isDefined(activeSequence)) {
                  await enrollmentRepository.update(
                    {
                      personId: person.id,
                      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                      waitingOn: In([
                        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
                        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                      ]),
                      nextActionAt: Equal(claimExpiresAt),
                    },
                    {
                      waitingOn: SEQUENCE_WAITING_ON.DELAY,
                      nextActionAt: startedAt,
                    },
                    workspaceTransactionManager,
                  );

                  return 'CANCELLED' as const;
                }

                const lockedPerson = await personRepository.findOne(
                  {
                    where: { id: person.id },
                    select: ['id', 'phones'],
                    lock: { mode: 'pessimistic_write' },
                  },
                  workspaceTransactionManager,
                );

                if (
                  !isDefined(lockedPerson) ||
                  isNonEmptyString(
                    lockedPerson.phones?.primaryPhoneNumber?.trim(),
                  )
                ) {
                  await enrollmentRepository.update(
                    {
                      personId: person.id,
                      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                      waitingOn: In([
                        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
                        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                      ]),
                      nextActionAt: Equal(claimExpiresAt),
                    },
                    {
                      waitingOn: SEQUENCE_WAITING_ON.DELAY,
                      nextActionAt: startedAt,
                    },
                    workspaceTransactionManager,
                  );

                  return 'CANCELLED' as const;
                }

                // The person lock can be acquired after this owner's short
                // pre-provider lease has expired and another enrollment has
                // taken ownership. Never let the stale owner cross Apollo's
                // paid boundary, even if its exact old row still exists.
                if (claimExpiresAt.getTime() <= startedAt.getTime()) {
                  await enrollmentRepository.update(
                    {
                      personId: person.id,
                      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                      waitingOn: In([
                        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
                        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                      ]),
                      nextActionAt: Equal(claimExpiresAt),
                    },
                    {
                      waitingOn: SEQUENCE_WAITING_ON.DELAY,
                      nextActionAt: startedAt,
                    },
                    workspaceTransactionManager,
                  );

                  return 'CANCELLED' as const;
                }

                const started = await enrollmentRepository.update(
                  {
                    id: enrollment.id,
                    personId: person.id,
                    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                    waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
                    currentStepId: step.id,
                    currentStepPosition: step.position,
                    nextActionAt: Equal(claimExpiresAt),
                  },
                  {
                    waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
                    nextActionAt: timeoutAt,
                  },
                  workspaceTransactionManager,
                );

                if (started.affected !== 1) {
                  await enrollmentRepository.update(
                    {
                      personId: person.id,
                      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                      nextActionAt: Equal(claimExpiresAt),
                    },
                    {
                      waitingOn: SEQUENCE_WAITING_ON.DELAY,
                      nextActionAt: startedAt,
                    },
                    workspaceTransactionManager,
                  );

                  return 'CANCELLED' as const;
                }

                await enrollmentRepository.update(
                  {
                    personId: person.id,
                    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                    waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                    nextActionAt: Equal(claimExpiresAt),
                  },
                  {
                    waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
                    nextActionAt: timeoutAt,
                  },
                  workspaceTransactionManager,
                );

                return 'STARTED' as const;
              },
            );

            if (startOutcome !== 'STARTED') {
              throw new SequenceApolloProviderStartCancelledError();
            }

            providerAttempt.startedAt = startedAt;
            providerAttempt.timeoutAt = timeoutAt;
          } catch (error) {
            // The HTTP call has not started when this callback rejects. An
            // exact cohort-token compensation covers both an ordinary rollback
            // and a transaction commit whose acknowledgement was lost.
            try {
              await transitionCohort({
                expectedWaitingOn: [
                  SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
                  SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                ],
                expectedExpiresAt: claimExpiresAt,
                values: {
                  waitingOn: SEQUENCE_WAITING_ON.DELAY,
                  nextActionAt: new Date(),
                },
              });
              await transitionCohort({
                expectedWaitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
                expectedExpiresAt: timeoutAt,
                values: {
                  waitingOn: SEQUENCE_WAITING_ON.DELAY,
                  nextActionAt: new Date(),
                },
              });
            } catch (compensationError) {
              this.logger.error(
                `Failed to compensate an unstarted Apollo cohort for person ${person.id}: ${this.toErrorMessage(compensationError)}`,
              );
            }

            throw error;
          }
        },
      });
    } catch (error) {
      if (await hasPersistedPhoneNumber()) {
        await resolveCohortWithPhone();

        return;
      }

      if (error instanceof ApolloEnrichmentProviderNotStartedError) {
        await transitionCohort({
          expectedWaitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
          expectedExpiresAt: providerAttempt.timeoutAt ?? claimExpiresAt,
          values: {
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            nextActionAt: new Date(),
          },
        });

        return;
      }

      if (error instanceof ApolloEnrichmentProviderRejectedError) {
        if (error.retryable) {
          await transitionCohort({
            expectedWaitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
            expectedExpiresAt: providerAttempt.timeoutAt ?? claimExpiresAt,
            values: {
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              nextActionAt: new Date(
                Date.now() +
                  SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
              ),
            },
          });
        } else {
          await failCohort(this.toErrorMessage(error));
        }

        return;
      }

      if (!providerAttempt.startedAt) {
        if (error instanceof ApolloEnrichmentError && !error.retryable) {
          await failCohort(this.toErrorMessage(error));

          return;
        }

        await releaseUnstartedCohort();

        if (!(error instanceof SequenceApolloProviderStartCancelledError)) {
          this.logger.warn(
            `Apollo phone enrichment failed before provider start for sequence enrollment ${enrollment.id}; released the cohort for retry: ${this.toErrorMessage(error)}`,
          );
        }

        return;
      }

      this.logger.warn(
        `Apollo phone enrichment returned an ambiguous error for sequence enrollment ${enrollment.id}; waiting for its callback until ${providerAttempt.timeoutAt?.toISOString()}: ${this.toErrorMessage(error)}`,
      );

      return;
    }

    if (await hasPersistedPhoneNumber()) {
      await resolveCohortWithPhone();

      return;
    }

    if (result === 'pending') {
      return;
    }

    if (result === 'identity-changed') {
      await transitionCohort({
        expectedWaitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        expectedExpiresAt: providerAttempt.timeoutAt ?? claimExpiresAt,
        values: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(),
        },
      });

      return;
    }

    await failCohort(
      result === 'disabled'
        ? SEQUENCE_EXECUTION_ERROR.APOLLO_ENRICHMENT_DISABLED
        : SEQUENCE_EXECUTION_ERROR.PHONE_ENRICHMENT_NOT_FOUND,
    );
  }

  private async advanceEnrollmentStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    expectedWaitingOn = SEQUENCE_WAITING_ON.DELAY,
    pausedLinkedinRetryActionId,
    step,
  }: {
    workspaceId?: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    expectedWaitingOn?: SequenceWaitingOn;
    pausedLinkedinRetryActionId?: string | null;
    step: SequenceStepWorkspaceEntity;
  }): Promise<void> {
    const advance = async (
      transactionManager?: WorkspaceEntityManager,
    ): Promise<boolean> => {
      const criteria = {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: expectedWaitingOn,
        currentStepPosition: enrollment.currentStepPosition,
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
      };
      const values = {
        currentStepId: step.id,
        currentStepPosition: step.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(),
      };
      const result = isDefined(transactionManager)
        ? await enrollmentRepository.update(
            criteria,
            values,
            transactionManager,
          )
        : await enrollmentRepository.update(criteria, values);

      return result.affected === 1;
    };

    if (!isDefined(pausedLinkedinRetryActionId)) {
      await advance();

      return;
    }

    if (!isDefined(workspaceId)) {
      throw new Error('Workspace id is required to consume a pause retry');
    }

    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    try {
      await workspaceDataSource.transaction(async (transactionManager) => {
        const workspaceTransactionManager =
          transactionManager as WorkspaceEntityManager;
        const activeSequence = await sequenceRepository.findOne(
          {
            where: {
              id: enrollment.sequenceId,
              status: SEQUENCE_STATUSES.ACTIVE,
            },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(activeSequence)) {
          return;
        }

        const lockedEnrollment = await enrollmentRepository.findOne(
          {
            where: {
              id: enrollment.id,
              sequenceId: activeSequence.id,
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              currentStepPosition: enrollment.currentStepPosition,
              currentStepId: isDefined(enrollment.currentStepId)
                ? enrollment.currentStepId
                : IsNull(),
            },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(lockedEnrollment)) {
          return;
        }

        const consumed = await this.consumePausedLinkedinRetryMarker({
          linkedinActionRepository,
          pausedLinkedinRetryActionId,
          enrollment,
          step,
          transactionManager: workspaceTransactionManager,
        });

        if (!consumed) {
          return;
        }

        if (!(await advance(workspaceTransactionManager))) {
          throw new SequencePauseRetryConflictError();
        }
      });
    } catch (error) {
      if (error instanceof SequencePauseRetryConflictError) {
        return;
      }

      throw error;
    }
  }

  private async consumePausedLinkedinRetryMarker({
    linkedinActionRepository,
    pausedLinkedinRetryActionId,
    enrollment,
    step,
    transactionManager,
  }: {
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    pausedLinkedinRetryActionId: string | null;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    transactionManager: WorkspaceEntityManager;
  }): Promise<boolean> {
    if (!isDefined(pausedLinkedinRetryActionId)) {
      return true;
    }

    const result = await linkedinActionRepository.update(
      {
        id: pausedLinkedinRetryActionId,
        sequenceEnrollmentId: enrollment.id,
        sequenceStepId: step.id,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      },
      {
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
      },
      transactionManager,
    );

    return result.affected === 1;
  }

  // Leaves the cursor on the step that could not run yet, so the next tick
  // re-resolves and retries exactly the same step.
  private async retryStepLater({
    enrollmentRepository,
    enrollment,
    reason,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    reason: string;
  }): Promise<void> {
    this.logger.warn(
      `Deferring sequence enrollment ${enrollment.id} for ${SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS}ms: ${reason}`,
    );

    await enrollmentRepository.update(
      {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: enrollment.currentStepPosition,
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
      },
      {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(
          Date.now() + SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
        ),
      },
    );
  }

  private async processConnectionRequestStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    pausedLinkedinRetryActionId,
    sequenceSettings,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    pausedLinkedinRetryActionId: string | null;
    sequenceSettings: SequenceSettings;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceConnectionRequestStepSettings;
  }): Promise<void> {
    if (!this.hasLinkedinProfileUrl(person)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    const senderConnectedAccountId =
      enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId;

    try {
      const ownerWorkspaceMemberId = await this.getSenderOwnerWorkspaceMemberId(
        {
          workspaceId,
          senderConnectedAccountId,
        },
      );
      // An invitation that is already sent or already queued is skipped
      // regardless of the step setting: re-inviting is not something the
      // sequence can do, and it burns a daily LinkedIn action slot.
      const hasOutstandingRequest = await this.hasOutstandingConnectionRequest({
        workspaceId,
        person,
        ownerWorkspaceMemberId,
      });

      if (hasOutstandingRequest) {
        await this.advanceEnrollmentStep({
          workspaceId,
          enrollmentRepository,
          enrollment,
          pausedLinkedinRetryActionId,
          step,
        });

        return;
      }

      const isConnected = await this.isPersonConnectedToSender({
        workspaceId,
        person,
        senderConnectedAccountId,
      });

      // LinkedIn cannot send another invitation to an existing connection.
      // Always skip here rather than consuming a queue slot that the browser
      // runner can only mark as skipped later.
      if (isConnected) {
        await this.advanceEnrollmentStep({
          workspaceId,
          enrollmentRepository,
          enrollment,
          pausedLinkedinRetryActionId,
          step,
        });

        return;
      }
    } catch (error) {
      if (error instanceof SequenceSenderUnavailableError) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: this.toErrorMessage(error),
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }

    const variables = await this.sequenceVariableService.buildVariables({
      workspaceId,
      person,
      connectedAccountId:
        enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId,
    });
    const renderedNote = renderSequenceTemplate(
      typeof settings.noteTemplate === 'string' ? settings.noteTemplate : '',
      variables,
      { escapeValues: false },
    );
    const noteText = renderedNote.slice(0, LINKEDIN_CONNECTION_NOTE_MAX_LENGTH);

    if (noteText.length < renderedNote.length) {
      this.logger.warn(
        `Truncated LinkedIn connection note for sequence enrollment ${enrollment.id} to ${LINKEDIN_CONNECTION_NOTE_MAX_LENGTH} characters`,
      );
    }

    await this.createLinkedinAction({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      pausedLinkedinRetryActionId,
      sequenceSettings,
      sequenceSenderConnectedAccountId,
      step,
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      noteText,
      reserveFrom: new Date(),
    });
  }

  private async processWithdrawConnectionRequestStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    pausedLinkedinRetryActionId,
    sequenceSettings,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    pausedLinkedinRetryActionId: string | null;
    sequenceSettings: SequenceSettings;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceWithdrawConnectionRequestStepSettings;
  }): Promise<void> {
    if (!this.hasLinkedinProfileUrl(person)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    try {
      const senderConnectedAccountId =
        enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId;
      const ownerWorkspaceMemberId = await this.getSenderOwnerWorkspaceMemberId(
        {
          workspaceId,
          senderConnectedAccountId,
        },
      );
      const [isConnected, hasOutstandingRequest] = await Promise.all([
        this.isPersonConnectedToSender({
          workspaceId,
          person,
          senderConnectedAccountId,
        }),
        this.hasOutstandingConnectionRequest({
          workspaceId,
          person,
          ownerWorkspaceMemberId,
        }),
      ]);

      if (isConnected || !hasOutstandingRequest) {
        await this.advanceEnrollmentStep({
          workspaceId,
          enrollmentRepository,
          enrollment,
          pausedLinkedinRetryActionId,
          step,
        });

        return;
      }
    } catch (error) {
      if (error instanceof SequenceSenderUnavailableError) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: this.toErrorMessage(error),
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }

    const delayMilliseconds =
      (this.toNonNegativeNumber(settings.withdrawAfterDays) * 24 * 60 * 60 +
        this.toNonNegativeNumber(settings.withdrawAfterHours) * 60 * 60) *
      1000;

    await this.createLinkedinAction({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      pausedLinkedinRetryActionId,
      sequenceSettings,
      sequenceSenderConnectedAccountId,
      step,
      type: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      noteText: '',
      reserveFrom: new Date(Date.now() + delayMilliseconds),
    });
  }

  private async processLinkedInMessageStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    pausedLinkedinRetryActionId,
    sequenceSettings,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    pausedLinkedinRetryActionId: string | null;
    sequenceSettings: SequenceSettings;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceLinkedInMessageStepSettings;
  }): Promise<void> {
    if (!this.hasLinkedinProfileUrl(person)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    // LinkedIn only allows direct messages to first-degree connections. Without
    // this check the action is scheduled, consumes a daily LinkedIn slot, and
    // then fails in the browser with an error the sequence cannot explain.
    // Gate the step with a condition to branch on this instead of failing.
    try {
      const isConnected = await this.isPersonConnectedToSender({
        workspaceId,
        person,
        senderConnectedAccountId:
          enrollment.senderConnectedAccountId ??
          sequenceSenderConnectedAccountId,
      });

      if (!isConnected) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_NOT_CONNECTED,
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }
    } catch (error) {
      if (error instanceof SequenceSenderUnavailableError) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: this.toErrorMessage(error),
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }

    const variables = await this.sequenceVariableService.buildVariables({
      workspaceId,
      person,
      connectedAccountId:
        enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId,
    });
    const messageText = renderSequenceTemplate(
      typeof settings.messageTemplate === 'string'
        ? settings.messageTemplate
        : '',
      variables,
      { escapeValues: false },
    ).trim();

    if (!isNonEmptyString(messageText)) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_MESSAGE_EMPTY,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    if (messageText.length > LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_MESSAGE_TOO_LONG,
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    await this.createLinkedinAction({
      workspaceId,
      enrollmentRepository,
      enrollment,
      person,
      pausedLinkedinRetryActionId,
      sequenceSettings,
      sequenceSenderConnectedAccountId,
      step,
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      noteText: messageText,
      reserveFrom: new Date(),
    });
  }

  private async createLinkedinAction({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    pausedLinkedinRetryActionId,
    sequenceSettings,
    sequenceSenderConnectedAccountId,
    step,
    type,
    noteText,
    reserveFrom,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    pausedLinkedinRetryActionId: string | null;
    sequenceSettings: SequenceSettings;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    type:
      | typeof LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST
      | typeof LINKEDIN_ACTION_TYPES.SEND_MESSAGE
      | typeof LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST;
    noteText: string;
    reserveFrom: Date;
  }): Promise<void> {
    try {
      // The sequence-level sender is the fallback everywhere else in this
      // service. Reading only the enrollment sender made LinkedIn steps fail
      // outright on sequences that configure the sender once, at the sequence.
      const connectedAccountId =
        enrollment.senderConnectedAccountId ?? sequenceSenderConnectedAccountId;

      if (!isDefined(connectedAccountId)) {
        throw new Error(SEQUENCE_EXECUTION_ERROR.MISSING_CONNECTED_ACCOUNT);
      }

      const ownerWorkspaceMemberId = await this.getSenderOwnerWorkspaceMemberId(
        {
          workspaceId,
          senderConnectedAccountId: connectedAccountId,
        },
      );
      const workspaceDataSource =
        await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
      const linkedinActionRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          LinkedinActionWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const sequenceRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      await workspaceDataSource.transaction(async (transactionManager) => {
        const workspaceTransactionManager =
          transactionManager as WorkspaceEntityManager;
        const activeSequence = await sequenceRepository.findOne(
          {
            where: {
              id: enrollment.sequenceId,
              status: SEQUENCE_STATUSES.ACTIVE,
            },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(activeSequence)) {
          return;
        }

        const lockedEnrollment = await enrollmentRepository.findOne(
          {
            where: {
              id: enrollment.id,
              sequenceId: activeSequence.id,
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              currentStepPosition: enrollment.currentStepPosition,
              currentStepId: isDefined(enrollment.currentStepId)
                ? enrollment.currentStepId
                : IsNull(),
            },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );

        if (!isDefined(lockedEnrollment)) {
          return;
        }

        const consumed = await this.consumePausedLinkedinRetryMarker({
          linkedinActionRepository,
          pausedLinkedinRetryActionId,
          enrollment,
          step,
          transactionManager: workspaceTransactionManager,
        });

        if (!consumed) {
          return;
        }

        const shouldDeduplicate =
          type === LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST ||
          type === LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST;

        if (shouldDeduplicate) {
          // Serialize person-level invitation mutations. The earlier read-side
          // check is useful for fast skips, but only this lock closes the race
          // between different enrollments reaching the same person together.
          await personRepository.findOne(
            {
              where: { id: person.id },
              select: ['id'],
              lock: { mode: 'pessimistic_write' },
            },
            workspaceTransactionManager,
          );

          const inFlightInvitationMutationCount =
            await linkedinActionRepository.count(
              {
                where: {
                  personId: person.id,
                  ownerWorkspaceMemberId,
                  type: In([
                    LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
                    LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
                  ]),
                  status: In([
                    LINKEDIN_ACTION_STATUSES.SCHEDULED,
                    LINKEDIN_ACTION_STATUSES.CLAIMED,
                  ]),
                },
              },
              workspaceTransactionManager,
            );

          if (inFlightInvitationMutationCount > 0) {
            const skipResult = await enrollmentRepository.update(
              {
                id: enrollment.id,
                status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                waitingOn: SEQUENCE_WAITING_ON.DELAY,
                currentStepPosition: enrollment.currentStepPosition,
                currentStepId: isDefined(enrollment.currentStepId)
                  ? enrollment.currentStepId
                  : IsNull(),
              },
              {
                currentStepId: step.id,
                currentStepPosition: step.position,
                waitingOn: SEQUENCE_WAITING_ON.DELAY,
                nextActionAt: new Date(),
              },
              workspaceTransactionManager,
            );

            if (
              isDefined(pausedLinkedinRetryActionId) &&
              skipResult.affected !== 1
            ) {
              throw new SequencePauseRetryConflictError();
            }

            return;
          }
        }

        const claimResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            currentStepPosition: enrollment.currentStepPosition,
            currentStepId: isDefined(enrollment.currentStepId)
              ? enrollment.currentStepId
              : IsNull(),
          },
          {
            currentStepId: step.id,
            currentStepPosition: step.position,
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            nextActionAt: null,
          },
          workspaceTransactionManager,
        );

        if (claimResult.affected !== 1) {
          if (isDefined(pausedLinkedinRetryActionId)) {
            throw new SequencePauseRetryConflictError();
          }

          return;
        }

        const scheduledAt =
          await this.sequenceLinkedinThrottleService.reserveSlot({
            workspaceId,
            ownerWorkspaceMemberId,
            settings: sequenceSettings,
            now: reserveFrom,
            transactionManager: workspaceTransactionManager,
          });

        await linkedinActionRepository.insert(
          {
            type,
            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
            scheduledAt,
            linkedinUrl: person.linkedinLink?.primaryLinkUrl ?? '',
            noteText,
            connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
            ownerWorkspaceMemberId,
            personId: person.id,
            sequenceEnrollmentId: enrollment.id,
            sequenceStepId: step.id,
          },
          workspaceTransactionManager,
        );
      });
    } catch (error) {
      if (error instanceof SequencePauseRetryConflictError) {
        return;
      }

      if (error instanceof SequenceSenderUnavailableError) {
        const errorMessage = this.toErrorMessage(error);

        this.logger.error(
          `Failed to schedule LinkedIn action for sequence enrollment ${enrollment.id}: ${errorMessage}`,
        );
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage,
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      throw error;
    }
  }

  private async isPersonConnectedToSender({
    workspaceId,
    person,
    senderConnectedAccountId,
  }: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    senderConnectedAccountId: string | null;
  }): Promise<boolean> {
    const ownerWorkspaceMemberId = await this.getSenderOwnerWorkspaceMemberId({
      workspaceId,
      senderConnectedAccountId,
    });
    const connectionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinConnectionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    const handle = normalizeLinkedinHandle(person.linkedinLink?.primaryLinkUrl);
    const where = [
      {
        ownerWorkspaceMemberId,
        personId: person.id,
      },
      ...(isNonEmptyString(handle)
        ? [
            {
              ownerWorkspaceMemberId,
              handle: ILike(handle),
            },
          ]
        : []),
    ];

    const [observedConnectedCount, syncedConnectionCount] = await Promise.all([
      linkedinActionRepository.count({
        where: {
          personId: person.id,
          ownerWorkspaceMemberId,
          status: In([
            LINKEDIN_ACTION_STATUSES.COMPLETED,
            LINKEDIN_ACTION_STATUSES.SKIPPED,
          ]),
          connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
          executedAt: MoreThanOrEqual(
            new Date(Date.now() - LINKEDIN_CONNECTION_OBSERVATION_MAX_AGE_MS),
          ),
        },
      }),
      connectionRepository.count({ where }),
    ]);

    // The browser runner can observe a first-degree connection before the
    // connector has synced its connection row. Keep that sender-scoped,
    // positive observation available to the very next sequence condition.
    return observedConnectedCount > 0 || syncedConnectionCount > 0;
  }

  private hasLinkedinProfileUrl(person: PersonWorkspaceEntity): boolean {
    const linkedinUrl = person.linkedinLink?.primaryLinkUrl;

    if (!isNonEmptyString(linkedinUrl)) {
      return false;
    }

    try {
      const parsedUrl = new URL(linkedinUrl);
      const isLinkedinHost =
        parsedUrl.hostname === 'linkedin.com' ||
        parsedUrl.hostname.endsWith('.linkedin.com');

      return (
        isLinkedinHost &&
        /^\/in\/[^/]+\/?$/i.test(parsedUrl.pathname) &&
        isNonEmptyString(normalizeLinkedinHandle(linkedinUrl))
      );
    } catch {
      return false;
    }
  }

  // "Did we invite this person?" is answered from what this workspace actually
  // sent (a completed connection-request action) and from what LinkedIn itself
  // reports (a sent invitation captured by the connector).
  private async wasLinkedinInvitationSent({
    workspaceId,
    person,
    ownerWorkspaceMemberId,
  }: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    ownerWorkspaceMemberId: string;
  }): Promise<boolean> {
    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const latestCompletedInvitationAction =
      await linkedinActionRepository.findOne({
        where: {
          personId: person.id,
          ownerWorkspaceMemberId,
          type: In([
            LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
            LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
          ]),
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          executedAt: Not(IsNull()),
        },
        order: { executedAt: 'DESC' },
      });

    if (isDefined(latestCompletedInvitationAction)) {
      if (
        latestCompletedInvitationAction.type ===
        LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST
      ) {
        return true;
      }

      const withdrawalExecutedAt = latestCompletedInvitationAction.executedAt;

      if (!isDefined(withdrawalExecutedAt)) {
        return false;
      }

      const handle = normalizeLinkedinHandle(
        person.linkedinLink?.primaryLinkUrl,
      );

      if (!isNonEmptyString(handle)) {
        return false;
      }

      const invitationRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          LinkedinInvitationWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      // Connector rows are retained as history. Only a newly observed sent
      // invitation after the withdrawal proves that an invitation exists now.
      return (
        (await invitationRepository.count({
          where: {
            ownerWorkspaceMemberId,
            handle,
            direction: 'SENT',
            sentAt: MoreThan(withdrawalExecutedAt),
          },
        })) > 0
      );
    }

    const handle = normalizeLinkedinHandle(person.linkedinLink?.primaryLinkUrl);

    if (!isNonEmptyString(handle)) {
      return false;
    }

    const invitationRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinInvitationWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    return (
      (await invitationRepository.count({
        where: { ownerWorkspaceMemberId, handle, direction: 'SENT' },
      })) > 0
    );
  }

  // A connection request that is already scheduled, claimed, or awaiting a
  // reply from LinkedIn must not be duplicated by another step or sequence.
  private async hasOutstandingConnectionRequest({
    workspaceId,
    person,
    ownerWorkspaceMemberId,
  }: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    ownerWorkspaceMemberId: string;
  }): Promise<boolean> {
    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const inFlightCount = await linkedinActionRepository.count({
      where: {
        personId: person.id,
        ownerWorkspaceMemberId,
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: In([
          LINKEDIN_ACTION_STATUSES.SCHEDULED,
          LINKEDIN_ACTION_STATUSES.CLAIMED,
        ]),
      },
    });

    if (inFlightCount > 0) {
      return true;
    }

    const latestTerminalAction = await linkedinActionRepository.findOne({
      where: {
        personId: person.id,
        ownerWorkspaceMemberId,
        type: In([
          LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
          LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
        ]),
        status: In([
          LINKEDIN_ACTION_STATUSES.COMPLETED,
          LINKEDIN_ACTION_STATUSES.SKIPPED,
        ]),
        executedAt: Not(IsNull()),
      },
      order: { executedAt: 'DESC' },
    });

    if (isDefined(latestTerminalAction)) {
      if (
        latestTerminalAction.type ===
        LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST
      ) {
        return (
          latestTerminalAction.status === LINKEDIN_ACTION_STATUSES.COMPLETED ||
          latestTerminalAction.connectionState ===
            LINKEDIN_CONNECTION_STATES.PENDING
        );
      }

      const withdrawalExecutedAt = latestTerminalAction.executedAt;

      if (!isDefined(withdrawalExecutedAt)) {
        return false;
      }

      const handle = normalizeLinkedinHandle(
        person.linkedinLink?.primaryLinkUrl,
      );

      if (!isNonEmptyString(handle)) {
        return false;
      }

      const invitationRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          LinkedinInvitationWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      // A later manual invitation can legitimately follow a withdrawal. Keep
      // it outstanding while ignoring the connector's older retained row.
      return (
        (await invitationRepository.count({
          where: {
            ownerWorkspaceMemberId,
            handle,
            direction: 'SENT',
            sentAt: MoreThan(withdrawalExecutedAt),
          },
        })) > 0
      );
    }

    const handle = normalizeLinkedinHandle(person.linkedinLink?.primaryLinkUrl);

    if (!isNonEmptyString(handle)) {
      return false;
    }

    const invitationRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        LinkedinInvitationWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    return (
      (await invitationRepository.count({
        where: { ownerWorkspaceMemberId, handle, direction: 'SENT' },
      })) > 0
    );
  }

  // Resolving the LinkedIn owner must not depend on the mailbox being synced:
  // these lookups back LinkedIn conditions and LinkedIn steps, neither of which
  // sends email.
  private async getSenderOwnerWorkspaceMemberId({
    workspaceId,
    senderConnectedAccountId,
  }: {
    workspaceId: string;
    senderConnectedAccountId: string | null;
  }): Promise<string> {
    if (!isDefined(senderConnectedAccountId)) {
      throw new SequenceSenderUnavailableError(
        SEQUENCE_EXECUTION_ERROR.MISSING_CONNECTED_ACCOUNT,
      );
    }

    const connectedAccount =
      await this.sequenceSenderService.getSenderAccountOrThrow({
        connectedAccountId: senderConnectedAccountId,
        workspaceId,
      });

    return this.sequenceSenderService.getOwnerWorkspaceMemberIdOrThrow({
      connectedAccount,
      workspaceId,
    });
  }

  private async processSendEmailStep({
    workspaceId,
    enrollmentRepository,
    enrollment,
    person,
    sequenceSettings,
    sequenceSenderConnectedAccountId,
    step,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    sequenceSettings: SequenceSettings;
    sequenceSenderConnectedAccountId: string | null;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceEmailStepSettings;
  }): Promise<void> {
    const effectiveSequenceSettings = resolveSequenceEmailWindowSettings({
      settings: sequenceSettings,
      recipientTimeZone: person.timeZone,
    });

    if (effectiveSequenceSettings.activeDays.length === 0) {
      return;
    }

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

    try {
      await this.sequenceSenderService.getReadySenderOrThrow({
        connectedAccountId,
        workspaceId,
      });
    } catch (error) {
      // A mailbox that is only mid-sync recovers on its own within a sync
      // cycle. Ending the enrollment here would burn the contact for good over
      // a condition that lasts seconds, so wait and retry the same step.
      if (error instanceof SequenceSenderNotReadyError) {
        await this.retryStepLater({
          enrollmentRepository,
          enrollment,
          reason: this.toErrorMessage(error),
        });

        return;
      }

      if (!(error instanceof SequenceSenderUnavailableError)) {
        throw error;
      }

      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
    }

    const sentEmailsByStepId = enrollment.sentEmailsByStepId ?? {};
    const now = new Date();

    if (
      enrollment.lastSendAttempt?.stepId === step.id &&
      !isDefined(enrollment.lastSendAttempt.preProviderFailure) &&
      !isDefined(sentEmailsByStepId[step.id])
    ) {
      if (hasLiveSequenceEmailSendLease({ enrollment, now })) {
        return;
      }

      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: SEQUENCE_EXECUTION_ERROR.SEND_INTERRUPTED,
        stepId: step.id,
        stepPosition: enrollment.currentStepPosition,
      });

      return;
    }

    const windowEligibleAt = this.getNextEligibleSendAt({
      now,
      lastSendAt: null,
      settings: effectiveSequenceSettings,
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

    const sendLockToken =
      await this.sequenceMailboxThrottleService.acquireSendLock({
        workspaceId,
        mailboxId: connectedAccountId,
      });

    if (!isDefined(sendLockToken)) {
      return;
    }

    const stopSendLockHeartbeat = this.startMailboxSendLockHeartbeat({
      workspaceId,
      mailboxId: connectedAccountId,
      token: sendLockToken,
    });

    try {
      if (!isDefined(enrollment.senderConnectedAccountId)) {
        const senderAssignmentResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            senderConnectedAccountId: IsNull(),
          },
          { senderConnectedAccountId: connectedAccountId },
        );

        if (senderAssignmentResult.affected !== 1) {
          return;
        }
      }

      const lastSendAt =
        await this.sequenceMailboxThrottleService.getLastSendAt({
          workspaceId,
          mailboxId: connectedAccountId,
          enrollmentRepository,
        });
      const sendAt = this.getNextEligibleSendAt({
        now,
        lastSendAt,
        settings: effectiveSequenceSettings,
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

      try {
        const claimToCompensate: {
          value: SequenceLastSendAttempt | null;
        } = { value: null };
        let claimedSend: {
          sendAttempt: SequenceLastSendAttempt;
          sendAttemptAt: Date;
        } | null;

        try {
          claimedSend =
            await this.sequenceSenderService.withLockedSenderAccountOrThrow({
              connectedAccountId,
              shouldRequireReadyMailbox: true,
              workspaceId,
              operation: async (_, coreTransactionManager) => {
                // The Redis mailbox lock is an advisory contention reduction and
                // may expire during a slow provider call. The connected-account
                // row is the durable serialization point, so pacing and the UTC
                // quota are checked again only after this lock is held.
                const sendAttemptAt = new Date();
                const lockedLastSendAt =
                  await this.sequenceMailboxThrottleService.getLastSendAt({
                    workspaceId,
                    mailboxId: connectedAccountId,
                    enrollmentRepository,
                  });
                const lockedSendAt = this.getNextEligibleSendAt({
                  now: sendAttemptAt,
                  lastSendAt: lockedLastSendAt,
                  settings: effectiveSequenceSettings,
                });

                if (lockedSendAt.getTime() > sendAttemptAt.getTime()) {
                  await this.rescheduleEmail({
                    enrollmentRepository,
                    enrollment,
                    nextActionAt: lockedSendAt,
                    now: sendAttemptAt,
                  });

                  return null;
                }

                const dailySendReservation =
                  await this.sequenceMailboxThrottleService.reserveUtcDailySend(
                    {
                      workspaceId,
                      mailboxId: connectedAccountId,
                      now: sendAttemptAt,
                      transactionManager: coreTransactionManager,
                    },
                  );

                if (!isDefined(dailySendReservation)) {
                  await this.rescheduleEmail({
                    enrollmentRepository,
                    enrollment,
                    nextActionAt: this.getNextUtcDailyLimitResetAt({
                      now: sendAttemptAt,
                      settings: effectiveSequenceSettings,
                    }),
                    now: sendAttemptAt,
                  });

                  return null;
                }

                const attemptedAt = sendAttemptAt.toISOString();
                const sendAttempt: SequenceLastSendAttempt = {
                  stepId: step.id,
                  attemptedAt,
                  dailyReservation: {
                    mailboxId: connectedAccountId,
                    token: dailySendReservation.reservationToken,
                    usageDate: dailySendReservation.usageDate,
                  },
                  ...(enrollment.lastSendAttempt?.stepId === step.id &&
                  isDefined(enrollment.lastSendAttempt.preProviderFailure)
                    ? {
                        preProviderFailure:
                          enrollment.lastSendAttempt.preProviderFailure,
                      }
                    : {}),
                  previousCursor: {
                    currentStepId: enrollment.currentStepId,
                    currentStepPosition: enrollment.currentStepPosition,
                    waitingOn: enrollment.waitingOn,
                    nextActionAt:
                      enrollment.nextActionAt?.toISOString() ?? null,
                    stopOnReply: enrollment.stopOnReply,
                  },
                };

                const claimAcquired = await this.claimEmailSendAttempt({
                  workspaceId,
                  enrollmentRepository,
                  enrollment,
                  step,
                  sendAttemptAt,
                  sendAttempt,
                  stopOnReply:
                    settings.stopOnReply ?? sequenceSettings.stopOnReply,
                });

                if (!claimAcquired) {
                  await this.sequenceMailboxThrottleService.releaseUtcDailySendReservation(
                    {
                      workspaceId,
                      mailboxId: connectedAccountId,
                      reservationToken: dailySendReservation.reservationToken,
                      usageDate: dailySendReservation.usageDate,
                      transactionManager: coreTransactionManager,
                    },
                  );

                  return null;
                }

                // The workspace claim commits independently from the enclosing
                // core transaction. Retain its exact token until that transaction
                // commits so a core commit failure can undo a claim that never
                // reached the provider.
                claimToCompensate.value = sendAttempt;

                return {
                  sendAttempt,
                  sendAttemptAt,
                };
              },
            });
        } catch (error) {
          if (isDefined(claimToCompensate.value)) {
            // The reservation token makes this release safe whether the core
            // transaction rolled back, committed, or only lost its commit ACK.
            // Keep the workspace claim until release succeeds so a later queue
            // retry can repair the exact same token.
            await this.releaseReservationAndRestoreUnstartedEmailClaim({
              workspaceId,
              enrollmentRepository,
              enrollment,
              sendAttempt: claimToCompensate.value,
            });
          }

          throw error;
        }

        if (!isDefined(claimedSend)) {
          return;
        }

        let providerStarted = false;
        let providerStartedAttempt: SequenceLastSendAttempt | null = null;
        let stopSendLeaseHeartbeat: () => void = () => undefined;

        try {
          let sendResult;

          try {
            sendResult = await this.sequenceEmailSenderService.send({
              workspaceId,
              enrollment,
              person,
              step,
              settings,
              connectedAccountId,
              onProviderStart: async () => {
                const providerStartedAt = new Date().toISOString();

                providerStartedAttempt = {
                  ...claimedSend.sendAttempt,
                  attemptedAt: providerStartedAt,
                  providerStartedAt,
                };
                const markedProviderStart = await this.markEmailProviderStarted(
                  {
                    enrollmentRepository,
                    enrollment,
                    step,
                    workspaceId,
                    claimedSendAttempt: claimedSend.sendAttempt,
                    providerStartedAttempt,
                    settings: effectiveSequenceSettings,
                  },
                );

                if (!markedProviderStart) {
                  throw new SequenceEmailClaimLostError();
                }

                providerStarted = true;
                stopSendLeaseHeartbeat = this.startEmailSendLeaseHeartbeat({
                  sendAttempt: providerStartedAttempt,
                  enrollmentId: enrollment.id,
                  enrollmentRepository,
                });

                const providerStartDate = new Date(providerStartedAt);

                try {
                  await this.sequenceMailboxThrottleService.recordEmailSendClaimWatermark(
                    {
                      workspaceId,
                      mailboxId: connectedAccountId,
                      date: providerStartDate,
                    },
                  );
                } catch (error) {
                  // The workspace provider-start marker and sent-email metadata
                  // remain durable pacing evidence. A core watermark outage must
                  // not misclassify the provider outcome or duplicate the send.
                  this.logger.warn(
                    `Could not record the durable mailbox send watermark for sequence enrollment ${enrollment.id}: ${this.toErrorMessage(error)}`,
                  );
                }

                try {
                  await this.sequenceMailboxThrottleService.setLastSendAt({
                    workspaceId,
                    mailboxId: connectedAccountId,
                    date: providerStartDate,
                  });
                } catch (error) {
                  // This cache watermark only improves stagger pacing. The
                  // workspace provider-start marker is the durable fallback.
                  this.logger.warn(
                    `Could not record the mailbox send watermark for sequence enrollment ${enrollment.id}: ${this.toErrorMessage(error)}`,
                  );
                }
              },
            });
          } catch (error) {
            if (!providerStarted) {
              const shouldCountPreProviderFailure =
                !(error instanceof SequenceEmailClaimLostError) &&
                !(error instanceof SequenceSenderNotReadyError);
              const preProviderFailureAttemptCount =
                (claimedSend.sendAttempt.preProviderFailure?.attemptCount ??
                  0) + 1;
              const restoredLastSendAttempt = shouldCountPreProviderFailure
                ? {
                    stepId: claimedSend.sendAttempt.stepId,
                    attemptedAt: new Date().toISOString(),
                    preProviderFailure: {
                      attemptCount: preProviderFailureAttemptCount,
                      errorMessage: this.toErrorMessage(error),
                      failedAt: new Date().toISOString(),
                    },
                    previousCursor: claimedSend.sendAttempt.previousCursor,
                  }
                : null;
              let restoredClaim =
                await this.releaseReservationAndRestoreUnstartedEmailClaim({
                  workspaceId,
                  enrollmentRepository,
                  enrollment,
                  sendAttempt: claimedSend.sendAttempt,
                  restoredLastSendAttempt,
                });

              // A database commit can succeed even when its acknowledgement
              // is lost. The provider callback did not return, so restoring
              // that just-written start marker is still pre-provider safe.
              if (!restoredClaim && isDefined(providerStartedAttempt)) {
                restoredClaim =
                  await this.releaseReservationAndRestoreUnstartedEmailClaim({
                    workspaceId,
                    enrollmentRepository,
                    enrollment,
                    sendAttempt: providerStartedAttempt,
                    allowProviderStartedAttempt: true,
                    restoredLastSendAttempt,
                  });
              }

              if (
                restoredClaim &&
                shouldCountPreProviderFailure &&
                preProviderFailureAttemptCount >=
                  SEQUENCE_EMAIL_PRE_PROVIDER_FAILURE_LIMIT &&
                !(error instanceof SequenceEmailPreparationPermanentError)
              ) {
                throw new SequenceEmailPreparationPermanentError(
                  `Email preparation failed ${preProviderFailureAttemptCount} times before provider start: ${this.toErrorMessage(error)}`,
                );
              }

              throw error;
            }

            const errorMessage = this.toErrorMessage(error);

            this.logger.error(
              `Email provider outcome is unknown for sequence enrollment ${enrollment.id}: ${errorMessage}`,
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

            return;
          }

          if (!isDefined(providerStartedAttempt)) {
            throw new Error(
              `Email provider returned without starting the durable send attempt for sequence enrollment ${enrollment.id}`,
            );
          }

          const dailyReservation = claimedSend.sendAttempt.dailyReservation;

          if (isDefined(dailyReservation)) {
            try {
              await this.sequenceMailboxThrottleService.consumeUtcDailySendReservation(
                {
                  workspaceId,
                  mailboxId: connectedAccountId,
                  reservationToken: dailyReservation.token,
                  usageDate: dailyReservation.usageDate,
                },
              );
            } catch (error) {
              // The usage count is already durable. Removing its recovery
              // token only bounds the per-day JSON list after the provider
              // returns; a cleanup outage must not change send outcome.
              this.logger.warn(
                `Could not consume the daily reservation token for sequence enrollment ${enrollment.id}: ${this.toErrorMessage(error)}`,
              );
            }
          }

          const sentEmailMetadata: SequenceSentEmailMetadata = {
            headerMessageId: sendResult.headerMessageId,
            threadExternalId: sendResult.threadExternalId,
            sentAt: sendResult.sentAt,
            variantId: sendResult.variantId,
            variantName: sendResult.variantName,
            connectedAccountId,
          };

          await this.persistSuccessfulEmailSendUntilRecorded({
            enrollmentRepository,
            enrollment,
            step,
            initialSentEmailsByStepId: sentEmailsByStepId,
            sentEmailMetadata,
            providerStartedAttempt,
          });

          try {
            await sendResult.persistSentMessage?.();
          } catch (error) {
            // Provider delivery and sequence attribution already succeeded.
            // Message-history persistence can be repaired independently and
            // must not turn a real send into a failed enrollment.
            this.logger.error(
              `Failed to persist sent-message history for sequence enrollment ${enrollment.id}: ${this.toErrorMessage(error)}`,
            );
          }

          try {
            await this.reemitInboundParticipantsSinceSend({
              workspaceId,
              personId: person.id,
              sentAt: sendResult.sentAt,
            });
          } catch (error) {
            // Delivery and its durable metadata already succeeded. A replay
            // lookup failure must not rewrite that real send as FAILED.
            this.logger.error(
              `Failed to reconcile in-flight replies for sequence enrollment ${enrollment.id}: ${this.toErrorMessage(error)}`,
            );
          }
        } finally {
          stopSendLeaseHeartbeat();
        }
      } catch (error) {
        if (error instanceof SequenceEmailPreparationPermanentError) {
          await this.failEnrollment({
            enrollmentRepository,
            enrollment,
            errorMessage: this.toErrorMessage(error),
            stepId: step.id,
            stepPosition: step.position,
          });

          return;
        }

        if (error instanceof SequenceSenderUnavailableError) {
          await this.failEnrollment({
            enrollmentRepository,
            enrollment,
            errorMessage: this.toErrorMessage(error),
            stepId: step.id,
            stepPosition: step.position,
          });

          return;
        }

        if (error instanceof SequenceSenderNotReadyError) {
          await this.retryStepLater({
            enrollmentRepository,
            enrollment,
            reason: this.toErrorMessage(error),
          });

          return;
        }

        throw error;
      }
    } finally {
      stopSendLockHeartbeat();
      await this.sequenceMailboxThrottleService.releaseSendLock({
        workspaceId,
        mailboxId: connectedAccountId,
        token: sendLockToken,
      });
    }
  }

  private async recoverDeliveredEmailSend({
    enrollmentRepository,
    enrollment,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
  }): Promise<boolean> {
    const sendAttempt = enrollment.lastSendAttempt;
    const deliveredEmail = sendAttempt?.deliveredEmail;

    if (
      !isDefined(sendAttempt) ||
      !isDefined(deliveredEmail) ||
      isDefined(enrollment.sentEmailsByStepId?.[sendAttempt.stepId])
    ) {
      return false;
    }

    await this.persistSuccessfulEmailSendUntilRecorded({
      enrollmentRepository,
      enrollment,
      step: {
        id: sendAttempt.stepId,
        position: deliveredEmail.stepPosition,
      },
      initialSentEmailsByStepId: enrollment.sentEmailsByStepId ?? {},
      sentEmailMetadata: deliveredEmail.metadata,
    });

    return true;
  }

  private async reemitInboundParticipantsSinceSend({
    workspaceId,
    personId,
    sentAt,
  }: {
    workspaceId: string;
    personId: string;
    sentAt: string;
  }): Promise<void> {
    const participants = await this.findInboundParticipantsSince({
      workspaceId,
      personId,
      since: sentAt,
    });

    if (participants.length === 0) {
      return;
    }

    this.workspaceEventEmitter.emitCustomBatchEvent(
      'messageParticipant_matched',
      [{ workspaceMemberId: null, participants }],
      workspaceId,
    );
  }

  private async findInboundParticipantsSince({
    workspaceId,
    personId,
    since,
  }: {
    workspaceId: string;
    personId: string;
    since: string;
  }): Promise<MessageParticipantWorkspaceEntity[]> {
    const messageParticipantRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        MessageParticipantWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    return messageParticipantRepository.find({
      where: {
        personId,
        role: MessageParticipantRole.FROM,
        createdAt: MoreThanOrEqual(since),
      },
      select: [
        'createdAt',
        'id',
        'messageId',
        'personId',
        'role',
        'workspaceMemberId',
      ],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  private startEmailSendLeaseHeartbeat({
    sendAttempt,
    enrollmentId,
    enrollmentRepository,
  }: {
    sendAttempt: SequenceLastSendAttempt;
    enrollmentId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  }): () => void {
    let currentAttempt = sendAttempt;
    let updateInProgress = false;
    const heartbeat = setInterval(() => {
      if (updateInProgress) {
        return;
      }

      updateInProgress = true;
      const nextAttempt = {
        ...currentAttempt,
        attemptedAt: new Date().toISOString(),
      };

      void enrollmentRepository
        .update(
          {
            id: enrollmentId,
            lastSendAttempt: Equal(currentAttempt),
          },
          { lastSendAttempt: nextAttempt },
        )
        .then(({ affected }) => {
          if (affected === 1) {
            currentAttempt = nextAttempt;
          }
        })
        .catch((error) => {
          this.logger.warn(
            `Could not renew the email send lease for sequence enrollment ${enrollmentId}: ${this.toErrorMessage(error)}`,
          );
        })
        .finally(() => {
          updateInProgress = false;
        });
    }, SEQUENCE_SEND_ATTEMPT_HEARTBEAT_MILLISECONDS);

    heartbeat.unref();

    return () => clearInterval(heartbeat);
  }

  private startMailboxSendLockHeartbeat({
    workspaceId,
    mailboxId,
    token,
  }: {
    workspaceId: string;
    mailboxId: string;
    token: string;
  }): () => void {
    let updateInProgress = false;
    const heartbeat = setInterval(() => {
      if (updateInProgress) {
        return;
      }

      updateInProgress = true;
      void this.sequenceMailboxThrottleService
        .renewSendLock({ workspaceId, mailboxId, token })
        .then((renewed) => {
          if (!renewed) {
            this.logger.warn(
              `Lost the mailbox send lock for sequence sender ${mailboxId}`,
            );
          }
        })
        .catch((error) => {
          this.logger.warn(
            `Could not renew the mailbox send lock for sequence sender ${mailboxId}: ${this.toErrorMessage(error)}`,
          );
        })
        .finally(() => {
          updateInProgress = false;
        });
    }, SEQUENCE_SEND_ATTEMPT_HEARTBEAT_MILLISECONDS);

    heartbeat.unref();

    return () => clearInterval(heartbeat);
  }

  private async claimEmailSendAttempt({
    workspaceId,
    enrollmentRepository,
    enrollment,
    step,
    sendAttemptAt,
    sendAttempt,
    stopOnReply,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    sendAttemptAt: Date;
    sendAttempt: SequenceLastSendAttempt;
    stopOnReply: boolean;
  }): Promise<boolean> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    return workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const activeSequence = await sequenceRepository.findOne(
        {
          where: {
            id: enrollment.sequenceId,
            status: SEQUENCE_STATUSES.ACTIVE,
          },
          select: ['id'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      // The sequence row is the pause/claim linearization point. If pause owns
      // it first, this executor observes PAUSED after waiting and never leases
      // or sends. If the worker owns it first, pause waits for this claim to
      // commit and the already-claimed provider operation remains in flight.
      if (!isDefined(activeSequence)) {
        return false;
      }

      const lockedEnrollment = await enrollmentRepository.findOne(
        {
          where: {
            id: enrollment.id,
            sequenceId: activeSequence.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepPosition: enrollment.currentStepPosition,
            currentStepId: isDefined(enrollment.currentStepId)
              ? enrollment.currentStepId
              : IsNull(),
            waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
            nextActionAt: LessThanOrEqual(sendAttemptAt),
          },
          select: ['id'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(lockedEnrollment)) {
        return false;
      }

      const claimResult = await enrollmentRepository.update(
        {
          id: enrollment.id,
          sequenceId: activeSequence.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepPosition: enrollment.currentStepPosition,
          currentStepId: isDefined(enrollment.currentStepId)
            ? enrollment.currentStepId
            : IsNull(),
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: LessThanOrEqual(sendAttemptAt),
        },
        {
          currentStepId: step.id,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: new Date(
            sendAttemptAt.getTime() + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
          ),
          stopOnReply,
          lastSendAttempt: sendAttempt,
        },
        workspaceTransactionManager,
      );

      return claimResult.affected === 1;
    });
  }

  private async releaseReservationAndRestoreUnstartedEmailClaim({
    workspaceId,
    enrollmentRepository,
    enrollment,
    sendAttempt,
    allowProviderStartedAttempt = false,
    restoredLastSendAttempt = null,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    sendAttempt: SequenceLastSendAttempt;
    allowProviderStartedAttempt?: boolean;
    restoredLastSendAttempt?: SequenceLastSendAttempt | null;
  }): Promise<boolean> {
    if (
      isDefined(sendAttempt.providerStartedAt) &&
      !allowProviderStartedAttempt &&
      !isDefined(sendAttempt.reservationReleasePendingAt)
    ) {
      return false;
    }

    let releasePendingAttempt = sendAttempt;

    // This workspace CAS is the provider-start/recovery linearization point.
    // Once it wins, the provider callback's exact claim CAS must fail; only
    // then is it safe to remove the matching core quota token.
    if (!isDefined(sendAttempt.reservationReleasePendingAt)) {
      releasePendingAttempt = {
        ...sendAttempt,
        reservationReleasePendingAt: new Date().toISOString(),
      };
      const markedReleasePending = await enrollmentRepository.update(
        {
          id: enrollment.id,
          sequenceId: enrollment.sequenceId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepPosition: enrollment.currentStepPosition,
          currentStepId: sendAttempt.stepId,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          lastSendAttempt: Equal(sendAttempt),
        },
        { lastSendAttempt: releasePendingAttempt },
      );

      if (markedReleasePending.affected !== 1) {
        return false;
      }
    }

    await this.releaseEmailDailyReservation({
      workspaceId,
      sendAttempt: releasePendingAttempt,
    });

    return this.restoreUnstartedEmailSendClaim({
      enrollmentRepository,
      enrollment,
      sendAttempt: releasePendingAttempt,
      allowProviderStartedAttempt,
      restoredLastSendAttempt,
    });
  }

  private async releaseReservationAndClearTerminalEmailClaim({
    workspaceId,
    enrollmentRepository,
    enrollment,
    sendAttempt,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    sendAttempt: SequenceLastSendAttempt;
  }): Promise<boolean> {
    let releasePendingAttempt = sendAttempt;

    if (!isDefined(sendAttempt.reservationReleasePendingAt)) {
      releasePendingAttempt = {
        ...sendAttempt,
        reservationReleasePendingAt: new Date().toISOString(),
      };
      const markedReleasePending = await enrollmentRepository.update(
        {
          id: enrollment.id,
          sequenceId: enrollment.sequenceId,
          status: enrollment.status,
          lastSendAttempt: Equal(sendAttempt),
        },
        { lastSendAttempt: releasePendingAttempt },
      );

      if (markedReleasePending.affected !== 1) {
        return false;
      }
    }

    await this.releaseEmailDailyReservation({
      workspaceId,
      sendAttempt: releasePendingAttempt,
    });

    const cleared = await enrollmentRepository.update(
      {
        id: enrollment.id,
        sequenceId: enrollment.sequenceId,
        status: enrollment.status,
        lastSendAttempt: Equal(releasePendingAttempt),
      },
      { lastSendAttempt: null },
    );

    return cleared.affected === 1;
  }

  private async markEmailProviderStarted({
    workspaceId,
    enrollmentRepository,
    enrollment,
    step,
    claimedSendAttempt,
    providerStartedAttempt,
    settings,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    claimedSendAttempt: SequenceLastSendAttempt;
    providerStartedAttempt: SequenceLastSendAttempt;
    settings: SequenceSettings;
  }): Promise<boolean> {
    const providerStartedAt = new Date(providerStartedAttempt.attemptedAt);
    const dailyReservation = claimedSendAttempt.dailyReservation;

    // A claim belongs to one UTC quota day and one configured send window.
    // Slow provider preparation must not carry yesterday's reservation or an
    // expired window across the actual irreversible boundary.
    if (
      !isDefined(dailyReservation) ||
      dailyReservation.usageDate !==
        providerStartedAt.toISOString().slice(0, 10) ||
      !isWithinSendingWindow(providerStartedAt, settings)
    ) {
      return false;
    }

    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

    return workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const activeSequence = await sequenceRepository.findOne(
        {
          where: {
            id: enrollment.sequenceId,
            status: SEQUENCE_STATUSES.ACTIVE,
          },
          select: ['id'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(activeSequence)) {
        return false;
      }

      const updateResult = await enrollmentRepository.update(
        {
          id: enrollment.id,
          sequenceId: activeSequence.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepPosition: enrollment.currentStepPosition,
          currentStepId: step.id,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          lastSendAttempt: Equal(claimedSendAttempt),
        },
        {
          lastSendAttempt: providerStartedAttempt,
          nextActionAt: new Date(
            Date.parse(providerStartedAttempt.attemptedAt) +
              SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
          ),
        },
        workspaceTransactionManager,
      );

      return updateResult.affected === 1;
    });
  }

  private async restoreUnstartedEmailSendClaim({
    enrollmentRepository,
    enrollment,
    sendAttempt,
    allowProviderStartedAttempt = false,
    restoredLastSendAttempt = null,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    sendAttempt: SequenceLastSendAttempt;
    allowProviderStartedAttempt?: boolean;
    restoredLastSendAttempt?: SequenceLastSendAttempt | null;
  }): Promise<boolean> {
    const previousCursor = sendAttempt.previousCursor;

    if (
      !isDefined(previousCursor) ||
      (isDefined(sendAttempt.providerStartedAt) && !allowProviderStartedAttempt)
    ) {
      return false;
    }

    const updateResult = await enrollmentRepository.update(
      {
        id: enrollment.id,
        sequenceId: enrollment.sequenceId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: enrollment.currentStepPosition,
        currentStepId: sendAttempt.stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        lastSendAttempt: Equal(sendAttempt),
      },
      {
        currentStepId: previousCursor.currentStepId,
        currentStepPosition: previousCursor.currentStepPosition,
        waitingOn: previousCursor.waitingOn,
        nextActionAt: isDefined(previousCursor.nextActionAt)
          ? new Date(previousCursor.nextActionAt)
          : null,
        stopOnReply: previousCursor.stopOnReply,
        lastSendAttempt: restoredLastSendAttempt,
      },
    );

    return updateResult.affected === 1;
  }

  private async releaseEmailDailyReservation({
    workspaceId,
    sendAttempt,
  }: {
    workspaceId: string;
    sendAttempt: SequenceLastSendAttempt;
  }): Promise<void> {
    const reservation = sendAttempt.dailyReservation;

    if (!isDefined(reservation)) {
      return;
    }

    await this.sequenceMailboxThrottleService.releaseUtcDailySendReservation({
      workspaceId,
      mailboxId: reservation.mailboxId,
      reservationToken: reservation.token,
      usageDate: reservation.usageDate,
    });
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

  private async checkpointDeliveredEmailSend({
    enrollmentRepository,
    enrollment,
    step,
    sentEmailMetadata,
    providerStartedAttempt,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: Pick<SequenceStepWorkspaceEntity, 'id' | 'position'>;
    sentEmailMetadata: SequenceSentEmailMetadata;
    providerStartedAttempt: SequenceLastSendAttempt;
  }): Promise<void> {
    let expectedSendAttempt = providerStartedAttempt;

    for (
      let attempt = 0;
      attempt < SEQUENCE_EMAIL_METADATA_RETRY_LIMIT;
      attempt += 1
    ) {
      const checkpointedSendAttempt: SequenceLastSendAttempt = {
        ...expectedSendAttempt,
        deliveredEmail: {
          stepPosition: step.position,
          metadata: sentEmailMetadata,
        },
      };
      const checkpointResult = await enrollmentRepository.update(
        {
          id: enrollment.id,
          lastSendAttempt: Equal(expectedSendAttempt),
        },
        { lastSendAttempt: checkpointedSendAttempt },
      );

      if (checkpointResult.affected === 1) {
        return;
      }

      const currentEnrollment = await enrollmentRepository.findOne({
        where: { id: enrollment.id },
        select: {
          id: true,
          lastSendAttempt: true,
          sentEmailsByStepId: true,
        },
      });

      if (!isDefined(currentEnrollment)) {
        throw new Error('Sequence enrollment disappeared after email send');
      }

      if (isDefined(currentEnrollment.sentEmailsByStepId?.[step.id])) {
        return;
      }

      const currentSendAttempt = currentEnrollment.lastSendAttempt;

      if (
        !isDefined(currentSendAttempt) ||
        currentSendAttempt.stepId !== providerStartedAttempt.stepId ||
        currentSendAttempt.providerStartedAt !==
          providerStartedAttempt.providerStartedAt
      ) {
        throw new Error(
          'Sequence email send attempt changed before delivery could be checkpointed',
        );
      }

      if (isDefined(currentSendAttempt.deliveredEmail)) {
        return;
      }

      // The provider can run longer than a heartbeat interval. Retry against
      // the renewed JSON value so the exact CAS cannot overwrite the lease.
      expectedSendAttempt = currentSendAttempt;
    }

    throw new Error('Could not checkpoint delivered sequence email metadata');
  }

  private async persistSuccessfulEmailSend({
    enrollmentRepository,
    enrollment,
    step,
    initialSentEmailsByStepId,
    sentEmailMetadata,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: Pick<SequenceStepWorkspaceEntity, 'id' | 'position'>;
    initialSentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
    sentEmailMetadata: SequenceSentEmailMetadata;
  }): Promise<void> {
    let expectedSentEmailsByStepId = initialSentEmailsByStepId;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextSentEmailsByStepId = {
        ...expectedSentEmailsByStepId,
        [step.id]: sentEmailMetadata,
      };
      const advanceResult = await enrollmentRepository.update(
        {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepPosition: enrollment.currentStepPosition,
          currentStepId: step.id,
          sentEmailsByStepId: Equal(expectedSentEmailsByStepId),
        },
        {
          currentStepPosition: step.position,
          sentEmailsByStepId: nextSentEmailsByStepId,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(),
        },
      );

      if (advanceResult.affected === 1) {
        return;
      }

      const currentEnrollment = await enrollmentRepository.findOne({
        where: { id: enrollment.id },
        select: {
          id: true,
          status: true,
          currentStepId: true,
          currentStepPosition: true,
          sentEmailsByStepId: true,
        },
      });

      if (!isDefined(currentEnrollment)) {
        throw new Error('Sequence enrollment disappeared after email send');
      }

      if (isDefined(currentEnrollment.sentEmailsByStepId?.[step.id])) {
        return;
      }

      expectedSentEmailsByStepId = currentEnrollment.sentEmailsByStepId ?? {};

      if (currentEnrollment.status !== SEQUENCE_ENROLLMENT_STATUSES.ACTIVE) {
        const nextMetadataOnlySentEmailsByStepId = {
          ...expectedSentEmailsByStepId,
          [step.id]: sentEmailMetadata,
        };
        const metadataOnlyResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            sentEmailsByStepId: Equal(expectedSentEmailsByStepId),
          },
          { sentEmailsByStepId: nextMetadataOnlySentEmailsByStepId },
        );

        if (metadataOnlyResult.affected === 1) {
          return;
        }
      }
    }

    throw new Error('Could not persist sequence email send attribution');
  }

  private async persistSuccessfulEmailSendUntilRecorded(
    parameters: Parameters<
      SequenceExecutorService['persistSuccessfulEmailSend']
    >[0] & {
      providerStartedAttempt?: SequenceLastSendAttempt;
    },
  ): Promise<void> {
    const { providerStartedAttempt, ...persistenceParameters } = parameters;
    let isDeliveryCheckpointRecorded = !isDefined(providerStartedAttempt);

    for (
      let retryCount = 0;
      retryCount < SEQUENCE_EMAIL_METADATA_RETRY_LIMIT;
      retryCount += 1
    ) {
      try {
        if (
          !isDeliveryCheckpointRecorded &&
          isDefined(providerStartedAttempt)
        ) {
          await this.checkpointDeliveredEmailSend({
            ...persistenceParameters,
            providerStartedAttempt,
          });
          isDeliveryCheckpointRecorded = true;
        }

        await this.persistSuccessfulEmailSend(persistenceParameters);

        return;
      } catch (error) {
        this.logger.error(
          `Email was delivered for sequence enrollment ${parameters.enrollment.id}, but its attribution could not yet be persisted: ${this.toErrorMessage(error)}`,
        );

        if (retryCount === SEQUENCE_EMAIL_METADATA_RETRY_LIMIT - 1) {
          throw error;
        }

        const retryDelay = Math.min(
          1000 * 2 ** Math.min(retryCount, 5),
          SEQUENCE_EMAIL_METADATA_RETRY_MAX_DELAY_MILLISECONDS,
        );

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
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

  private getNextUtcDailyLimitResetAt({
    now,
    settings,
  }: {
    now: Date;
    settings: SequenceSettings;
  }): Date {
    const resetAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );

    return isWithinSendingWindow(resetAt, settings)
      ? resetAt
      : nextWindowOpen(resetAt, settings);
  }

  private isManualExecution(
    settings: SequenceActionExecutionSettings,
  ): boolean {
    return settings.executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL;
  }

  private async failEnrollment({
    enrollmentRepository,
    enrollment,
    errorMessage,
    expectedWaitingOn,
    stepId,
    stepPosition,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    errorMessage: string;
    expectedWaitingOn?: SequenceWaitingOn;
    stepId: string;
    stepPosition: number;
  }): Promise<void> {
    await enrollmentRepository.update(
      {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: enrollment.currentStepPosition,
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
        ...(isDefined(expectedWaitingOn)
          ? { waitingOn: expectedWaitingOn }
          : {}),
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
