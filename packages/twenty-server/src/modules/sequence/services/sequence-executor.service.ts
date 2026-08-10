import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
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
  type SequenceWithdrawConnectionRequestStepSettings,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { ILike, In, IsNull, LessThanOrEqual } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { LinkedinInvitationWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-invitation.workspace-entity';
import { LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { normalizeLinkedinHandle } from 'src/modules/linkedin/utils/linkedin-identity-matching.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import {
  LINKEDIN_CONNECTION_NOTE_MAX_LENGTH,
  LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH,
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
import { findNextSequenceStep } from 'src/modules/sequence/utils/find-next-sequence-step.util';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import { renderSequenceTemplate } from 'src/modules/sequence/utils/render-sequence-template.util';
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
    private readonly sequenceLinkedinThrottleService: SequenceLinkedinThrottleService,
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
            person,
            senderConnectedAccountId:
              enrollment.senderConnectedAccountId ??
              sequence.senderConnectedAccountId,
            settings: currentStep.settings,
          }))
            ? SEQUENCE_CONDITION_BRANCHES.YES
            : SEQUENCE_CONDITION_BRANCHES.NO;
        } catch (error) {
          await this.failEnrollment({
            enrollmentRepository,
            enrollment,
            errorMessage: this.toErrorMessage(error),
            stepId: currentStep.id,
            stepPosition: currentStep.position,
          });

          return;
        }
      }

      const nextStep = findNextSequenceStep({
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

            return;
          }

          await this.processConnectionRequestStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            settings: nextStep.settings,
          });

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

            return;
          }

          await this.processLinkedInMessageStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            settings: nextStep.settings,
          });

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

            return;
          }

          await this.processWithdrawConnectionRequestStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            sequenceSettings: parseSequenceSettings(sequence.settings),
            sequenceSenderConnectedAccountId: sequence.senderConnectedAccountId,
            step: nextStep,
            settings: nextStep.settings,
          });

          return;
        case SEQUENCE_STEP_TYPES.SEND_EMAIL:
          if (this.isManualExecution(nextStep.settings)) {
            await this.processManualActionStep({
              workspaceId,
              enrollmentRepository,
              enrollment,
              person,
              step: nextStep,
              settings: nextStep.settings,
              taskType: SEQUENCE_TASK_TYPES.EMAIL,
              defaultTitle: 'Send email to {{ fullName }}',
            });

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
            steps,
            settings: nextStep.settings,
          });

          return;
        case SEQUENCE_STEP_TYPES.CONDITION:
          await this.processConditionStep({
            enrollmentRepository,
            enrollment,
            step: nextStep,
          });

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

            return;
          }

          await this.processEnrichPhoneNumberStep({
            workspaceId,
            enrollmentRepository,
            enrollment,
            person,
            step: nextStep,
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
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage,
        stepId: step.id,
        stepPosition: step.position,
      });
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
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
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
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
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
      const isConnected = await this.isPersonConnectedToSender({
        workspaceId,
        person,
        senderConnectedAccountId:
          enrollment.senderConnectedAccountId ??
          sequenceSenderConnectedAccountId,
      });

      if (isConnected) {
        await this.advanceEnrollmentStep({
          enrollmentRepository,
          enrollment,
          step,
        });

        return;
      }
    } catch (error) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
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
    person,
    senderConnectedAccountId,
    settings,
  }: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    senderConnectedAccountId: string | null;
    settings: SequenceConditionStepSettings;
  }): Promise<boolean> {
    const outcome = await this.evaluateRawCondition({
      workspaceId,
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
    person,
    senderConnectedAccountId,
    settings,
  }: {
    workspaceId: string;
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
        return isNonEmptyString(person.phones?.primaryPhoneNumber);
      case SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE: {
        const ownerWorkspaceMemberId =
          await this.getSenderOwnerWorkspaceMemberId({
            workspaceId,
            senderConnectedAccountId,
          });
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
                },
              ]
            : [],
        );

        if (messageWhere.length === 0) {
          return false;
        }

        const messageRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            LinkedinMessageWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        // LinkedIn does not expose recipient read receipts. Inbound activity is
        // the connector-backed signal that the recipient saw the conversation.
        return (
          (await messageRepository.count({
            where: messageWhere,
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
    if (!isNonEmptyString(person.phones?.primaryPhoneNumber)) {
      const result = await this.apolloEnrichmentService.enrichPerson({
        workspaceId,
        personId: person.id,
        mode: 'phone',
      });

      if (result === 'disabled') {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: SEQUENCE_EXECUTION_ERROR.APOLLO_ENRICHMENT_DISABLED,
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }

      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const enrichedPerson = await personRepository.findOne({
        where: { id: person.id },
      });

      if (
        !isDefined(enrichedPerson) ||
        !isNonEmptyString(enrichedPerson.phones?.primaryPhoneNumber)
      ) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollment,
          errorMessage: SEQUENCE_EXECUTION_ERROR.PHONE_ENRICHMENT_NOT_FOUND,
          stepId: step.id,
          stepPosition: step.position,
        });

        return;
      }
    }

    await this.advanceEnrollmentStep({
      enrollmentRepository,
      enrollment,
      step,
    });
  }

  private async advanceEnrollmentStep({
    enrollmentRepository,
    enrollment,
    step,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
  }): Promise<void> {
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
        currentStepId: step.id,
        currentStepPosition: step.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(),
      },
    );
  }

  private async processConnectionRequestStep({
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
          enrollmentRepository,
          enrollment,
          step,
        });

        return;
      }

      const shouldSkipIfAlreadyConnected =
        settings.skipIfAlreadyConnected !== false;

      if (shouldSkipIfAlreadyConnected) {
        const isConnected = await this.isPersonConnectedToSender({
          workspaceId,
          person,
          senderConnectedAccountId,
        });

        if (isConnected) {
          await this.advanceEnrollmentStep({
            enrollmentRepository,
            enrollment,
            step,
          });

          return;
        }
      }
    } catch (error) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
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
      const isConnected = await this.isPersonConnectedToSender({
        workspaceId,
        person,
        senderConnectedAccountId:
          enrollment.senderConnectedAccountId ??
          sequenceSenderConnectedAccountId,
      });

      if (isConnected) {
        await this.advanceEnrollmentStep({
          enrollmentRepository,
          enrollment,
          step,
        });

        return;
      }
    } catch (error) {
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
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
      await this.failEnrollment({
        enrollmentRepository,
        enrollment,
        errorMessage: this.toErrorMessage(error),
        stepId: step.id,
        stepPosition: step.position,
      });

      return;
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

      const { connectedAccount } =
        await this.sequenceSenderService.getReadySenderOrThrow({
          connectedAccountId,
          workspaceId,
        });
      const ownerWorkspaceMemberId =
        await this.sequenceSenderService.getOwnerWorkspaceMemberIdOrThrow({
          connectedAccount,
          workspaceId,
        });
      const workspaceDataSource =
        await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
      const linkedinActionRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          LinkedinActionWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

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
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            nextActionAt: null,
          },
          workspaceTransactionManager,
        );

        if (claimResult.affected !== 1) {
          return;
        }

        const scheduledAt =
          await this.sequenceLinkedinThrottleService.reserveSlot({
            workspaceId,
            sequenceId: enrollment.sequenceId,
            settings: sequenceSettings,
            now: reserveFrom,
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

    return (await connectionRepository.count({ where })) > 0;
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
    const completedRequestCount = await linkedinActionRepository.count({
      where: {
        personId: person.id,
        ownerWorkspaceMemberId,
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      },
    });

    if (completedRequestCount > 0) {
      return true;
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
      },
      order: { createdAt: 'DESC' },
    });

    if (isDefined(latestTerminalAction)) {
      // A completed withdrawal supersedes the historical sent-invitation row.
      // Without this ordering, a person could never be invited again after a
      // withdrawal because connector sync intentionally retains history.
      return (
        latestTerminalAction.type ===
        LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST
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

  private async getSenderOwnerWorkspaceMemberId({
    workspaceId,
    senderConnectedAccountId,
  }: {
    workspaceId: string;
    senderConnectedAccountId: string | null;
  }): Promise<string> {
    if (!isDefined(senderConnectedAccountId)) {
      throw new Error(SEQUENCE_EXECUTION_ERROR.MISSING_CONNECTED_ACCOUNT);
    }

    const { connectedAccount } =
      await this.sequenceSenderService.getReadySenderOrThrow({
        connectedAccountId: senderConnectedAccountId,
        workspaceId,
      });
    const ownerWorkspaceMemberId =
      await this.sequenceSenderService.getOwnerWorkspaceMemberIdOrThrow({
        connectedAccount,
        workspaceId,
      });

    return ownerWorkspaceMemberId;
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

    try {
      await this.sequenceSenderService.getReadySenderOrThrow({
        connectedAccountId,
        workspaceId,
      });
    } catch (error) {
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

  private isManualExecution(
    settings: SequenceActionExecutionSettings,
  ): boolean {
    return settings.executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL;
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
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
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
