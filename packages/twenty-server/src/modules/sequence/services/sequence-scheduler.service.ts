import { Injectable, Logger } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceSettings,
  type SequenceWaitingOn,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Raw,
} from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceLinkedinInvitationReconcilerService } from 'src/modules/sequence/services/sequence-linkedin-invitation-reconciler.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import {
  DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
  LINKEDIN_ACTION_CLAIM_LEASE_MS,
  LINKEDIN_ACTION_MAX_AGE_MS,
  SEQUENCE_SCHEDULER_BATCH_SIZE,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT,
  SEQUENCE_LINKEDIN_RECONCILE_GRACE_MS,
  SEQUENCE_METRICS_RECONCILE_BATCH_SIZE,
  SEQUENCE_METRICS_RECONCILE_GRACE_MS,
  SEQUENCE_SEND_SLOT_LOOKAHEAD_MILLISECONDS,
  SEQUENCE_TASK_RECONCILE_GRACE_MS,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';
import { dateAtMillisecondPrecisionFindOperator } from 'src/modules/sequence/utils/date-at-millisecond-precision-find-operator.util';
import { findNextSequenceStep } from 'src/modules/sequence/utils/find-next-sequence-step.util';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import {
  isRecipientSequenceEmailWindow,
  resolveSequenceEmailWindowSettings,
} from 'src/modules/sequence/utils/resolve-sequence-email-window-settings.util';
import {
  isWithinSendingWindow,
  nextWindowOpen,
  startOfDayInTimezone,
} from 'src/modules/sequence/utils/sequence-window.util';

type DueEmail = {
  enrollment: SequenceEnrollmentWorkspaceEntity;
  settings: SequenceSettings;
};

const APOLLO_ENRICHMENT_WAITING_STATES: readonly SequenceWaitingOn[] = [
  SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
  SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
  SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
];

@Injectable()
export class SequenceSchedulerService {
  private readonly logger = new Logger(SequenceSchedulerService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
    private readonly sequenceMailboxThrottleService: SequenceMailboxThrottleService,
    private readonly sequenceTaskCompletionService: SequenceTaskCompletionService,
    private readonly sequenceLinkedinInvitationReconcilerService: SequenceLinkedinInvitationReconcilerService,
    private readonly sequenceLinkedinThrottleService: SequenceLinkedinThrottleService,
    private readonly sequenceLinkedinReplyListener: SequenceLinkedinReplyListener,
    private readonly sequenceMetricsService: SequenceMetricsService,
  ) {}

  async tick(workspaceId: string, now = new Date()): Promise<void> {
    try {
      await this.sequenceLinkedinInvitationReconcilerService.reconcile({
        workspaceId,
        now,
      });
    } catch (error) {
      // Invitation repair is maintenance, not an admission gate. A transient
      // sync failure must not suppress unrelated sequence work for this tick.
      this.logger.error(
        `Failed to reconcile LinkedIn invitations for workspace ${workspaceId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
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
      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      await this.sweepLinkedinActions({
        workspaceId,
        enrollmentRepository,
        linkedinActionRepository,
        sequenceRepository,
        now,
      });

      await this.reconcileLinkedinWaitingEnrollments({
        workspaceId,
        enrollmentRepository,
        linkedinActionRepository,
        now,
      });
      await this.reconcileTaskWaitingEnrollments({
        workspaceId,
        enrollmentRepository,
        now,
      });
      await this.enqueueOrphanedEmailReservationRecoveries({
        workspaceId,
        enrollmentRepository,
        sequenceRepository,
        now,
      });
      const stepRepository = await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceStepWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
      const activeSequences = await sequenceRepository.find({
        where: { status: SEQUENCE_STATUSES.ACTIVE },
      });
      const activeSequencesWithSettings = activeSequences.map((sequence) => ({
        sequence,
        settings: parseSequenceSettings(sequence.settings),
      }));
      const fixedWindowEligibleSequences = activeSequencesWithSettings.filter(
        ({ settings }) => isWithinSendingWindow(now, settings),
      );
      const executionSequences = activeSequencesWithSettings.filter(
        ({ settings }) =>
          isWithinSendingWindow(now, settings) ||
          (settings.activeDays.length > 0 &&
            isRecipientSequenceEmailWindow(settings)),
      );

      if (executionSequences.length === 0) {
        await this.reconcileStaleSequenceMetrics({
          workspaceId,
          sequenceRepository,
          now,
        });

        return;
      }

      for (const { sequence } of executionSequences) {
        await this.admitPendingEnrollments({
          enrollmentRepository,
          sequenceRepository,
          sequence,
          now,
        });
      }

      const sequenceIds = executionSequences.map(({ sequence }) => sequence.id);
      const [dueEnrollments, steps] = await Promise.all([
        enrollmentRepository.find({
          where: {
            sequenceId: In(sequenceIds),
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: In([
              SEQUENCE_WAITING_ON.DELAY,
              SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
              SEQUENCE_WAITING_ON.TASK_DEADLINE,
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
            ]),
            nextActionAt: LessThanOrEqual(now),
          },
          order: { nextActionAt: 'ASC' },
          take: SEQUENCE_SCHEDULER_BATCH_SIZE,
        }),
        stepRepository.find({
          where: { sequenceId: In(sequenceIds) },
          order: { position: 'ASC' },
        }),
      ]);
      const settingsBySequenceId = new Map(
        executionSequences.map(({ sequence, settings }) => [
          sequence.id,
          settings,
        ]),
      );
      const senderBySequenceId = new Map(
        executionSequences.map(({ sequence }) => [
          sequence.id,
          sequence.senderConnectedAccountId,
        ]),
      );
      const fixedWindowEligibleSequenceIds = new Set(
        fixedWindowEligibleSequences.map(({ sequence }) => sequence.id),
      );
      const stepsBySequenceId = this.groupStepsBySequenceId(steps);
      const pausedLinkedinRetryEnrollmentIds =
        await this.getPausedLinkedinRetryEnrollmentIds({
          enrollments: dueEnrollments,
          linkedinActionRepository,
          stepsBySequenceId,
        });
      const recipientTimeZonePersonIds = [
        ...new Set(
          dueEnrollments
            .filter((enrollment) => {
              const settings = settingsBySequenceId.get(enrollment.sequenceId);

              return (
                isDefined(settings) && isRecipientSequenceEmailWindow(settings)
              );
            })
            .map(({ personId }) => personId),
        ),
      ];
      const recipientTimeZoneByPersonId = new Map<string, string | null>();

      if (recipientTimeZonePersonIds.length > 0) {
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            PersonWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const recipients = await personRepository.find({
          where: { id: In(recipientTimeZonePersonIds) },
          select: { id: true, timeZone: true },
        });

        for (const recipient of recipients) {
          recipientTimeZoneByPersonId.set(recipient.id, recipient.timeZone);
        }
      }

      const dueEmailsByMailboxId = new Map<string, DueEmail[]>();

      for (const enrollment of dueEnrollments) {
        const sequenceSteps =
          stepsBySequenceId.get(enrollment.sequenceId) ?? [];
        const currentStep = sequenceSteps.find(
          (step) => step.id === enrollment.currentStepId,
        );
        // An enrollment waiting on phone enrichment is due on a lease deadline,
        // not because the step finished. Resolving past it here would schedule
        // the following step and silently drop the enrichment the executor is
        // still responsible for finishing, timing out or failing.
        const isRecoveringApolloEnrichment =
          currentStep?.settings.type ===
            SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER &&
          APOLLO_ENRICHMENT_WAITING_STATES.some(
            (waitingOn) => enrollment.waitingOn === waitingOn,
          );
        const nextStep =
          pausedLinkedinRetryEnrollmentIds.has(enrollment.id) ||
          isRecoveringApolloEnrichment
            ? currentStep
            : findNextSequenceStep({
                steps: sequenceSteps,
                currentStepId: enrollment.currentStepId,
                currentStepPosition: enrollment.currentStepPosition,
              });
        const settings = settingsBySequenceId.get(enrollment.sequenceId);
        const isAutomatedEmail =
          isDefined(nextStep) &&
          nextStep.settings.type === SEQUENCE_STEP_TYPES.SEND_EMAIL &&
          nextStep.settings.executionMode !==
            SEQUENCE_ACTION_EXECUTION_MODES.MANUAL;

        if (!isAutomatedEmail) {
          // Finishing an enrichment already paid for is repair, not outreach:
          // deferring it to the next window would also push out the lease it is
          // due on and keep the enrollment parked for another whole window.
          if (
            !isRecoveringApolloEnrichment &&
            !fixedWindowEligibleSequenceIds.has(enrollment.sequenceId)
          ) {
            if (isDefined(settings) && isDefined(enrollment.waitingOn)) {
              await enrollmentRepository.update(
                {
                  id: enrollment.id,
                  status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                  currentStepPosition: enrollment.currentStepPosition,
                  currentStepId: isDefined(enrollment.currentStepId)
                    ? enrollment.currentStepId
                    : IsNull(),
                  updatedAt: dateAtMillisecondPrecisionFindOperator(
                    enrollment.updatedAt,
                  ),
                  waitingOn: enrollment.waitingOn,
                  nextActionAt: LessThanOrEqual(now),
                },
                { nextActionAt: nextWindowOpen(now, settings) },
              );
            }

            continue;
          }

          await this.sequenceQueueService.enqueueProcess({
            workspaceId,
            enrollmentId: enrollment.id,
          });

          continue;
        }

        if (!isDefined(settings)) {
          continue;
        }

        const effectiveSettings = resolveSequenceEmailWindowSettings({
          settings,
          recipientTimeZone: recipientTimeZoneByPersonId.get(
            enrollment.personId,
          ),
        });

        if (effectiveSettings.activeDays.length === 0) {
          continue;
        }

        const mailboxId =
          enrollment.senderConnectedAccountId ??
          senderBySequenceId.get(enrollment.sequenceId);

        if (!isDefined(mailboxId)) {
          await this.sequenceQueueService.enqueueProcess({
            workspaceId,
            enrollmentId: enrollment.id,
          });

          continue;
        }

        const mailboxEnrollments = dueEmailsByMailboxId.get(mailboxId) ?? [];

        mailboxEnrollments.push({
          enrollment,
          settings: effectiveSettings,
        });
        dueEmailsByMailboxId.set(mailboxId, mailboxEnrollments);
      }

      for (const [mailboxId, dueEmails] of dueEmailsByMailboxId) {
        await this.allocateMailboxSlots({
          workspaceId,
          mailboxId,
          dueEmails,
          enrollmentRepository,
          activeSequenceIds: activeSequences.map((sequence) => sequence.id),
          now,
        });
      }

      await this.reconcileStaleSequenceMetrics({
        workspaceId,
        sequenceRepository,
        now,
      });
    }, buildSystemAuthContext(workspaceId));
  }

  private async enqueueOrphanedEmailReservationRecoveries({
    workspaceId,
    enrollmentRepository,
    sequenceRepository,
    now,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    sequenceRepository: WorkspaceRepository<SequenceWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const unstartedReservation = Raw(
      (columnAlias) =>
        `${columnAlias} ->> 'dailyReservation' IS NOT NULL ` +
        `AND ${columnAlias} ->> 'preProviderFailure' IS NULL ` +
        `AND ${columnAlias} ->> 'deliveredEmail' IS NULL ` +
        `AND (` +
        `${columnAlias} ->> 'providerStartedAt' IS NULL ` +
        `OR ${columnAlias} ->> 'reservationReleasePendingAt' IS NOT NULL` +
        `)`,
    );
    const recoveryScopes = [
      {
        status: In([
          SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
          SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          SEQUENCE_ENROLLMENT_STATUSES.FAILED,
          SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
        ]),
        lastSendAttempt: unstartedReservation,
      },
      {
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        lastSendAttempt: unstartedReservation,
      },
    ];
    const candidates = await enrollmentRepository.find({
      where: recoveryScopes,
      select: [
        'id',
        'lastSendAttempt',
        'sentEmailsByStepId',
        'sequenceId',
        'status',
        'nextActionAt',
      ],
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: SEQUENCE_SCHEDULER_BATCH_SIZE,
    });
    const activeCandidateSequenceIds = [
      ...new Set(
        candidates
          .filter(
            ({ status }) => status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          )
          .map(({ sequenceId }) => sequenceId),
      ),
    ];
    const candidateSequenceById = new Map<string, SequenceWorkspaceEntity>();

    if (activeCandidateSequenceIds.length > 0) {
      const candidateSequences = await sequenceRepository.find({
        where: { id: In(activeCandidateSequenceIds) },
        select: ['id', 'status', 'deletedAt'],
        withDeleted: true,
      });

      for (const sequence of candidateSequences) {
        candidateSequenceById.set(sequence.id, sequence);
      }
    }

    for (const enrollment of candidates) {
      const sendAttempt = enrollment.lastSendAttempt;

      // Keep the in-memory guard even though the database predicate filters
      // these fields. It protects cleanup if a custom repository or future
      // query adapter returns a broader candidate set.
      if (
        !isDefined(sendAttempt?.dailyReservation) ||
        isDefined(sendAttempt.preProviderFailure) ||
        isDefined(sendAttempt.deliveredEmail) ||
        (isDefined(sendAttempt.providerStartedAt) &&
          !isDefined(sendAttempt.reservationReleasePendingAt)) ||
        isDefined(enrollment.sentEmailsByStepId?.[sendAttempt.stepId])
      ) {
        continue;
      }

      if (enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE) {
        const candidateSequence = candidateSequenceById.get(
          enrollment.sequenceId,
        );
        const retryAt = isDefined(enrollment.nextActionAt)
          ? enrollment.nextActionAt.getTime()
          : null;
        const activeClaimIsStillLive =
          !isDefined(sendAttempt.reservationReleasePendingAt) &&
          candidateSequence?.status === SEQUENCE_STATUSES.ACTIVE &&
          !isDefined(candidateSequence.deletedAt) &&
          isDefined(retryAt) &&
          retryAt > now.getTime();

        if (activeClaimIsStillLive) {
          continue;
        }
      }

      await this.sequenceQueueService.enqueueProcess({
        workspaceId,
        enrollmentId: enrollment.id,
      });
    }
  }

  private async sweepLinkedinActions({
    workspaceId,
    enrollmentRepository,
    linkedinActionRepository,
    sequenceRepository,
    now,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    sequenceRepository: WorkspaceRepository<SequenceWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const claimExpiredBefore = new Date(
      now.getTime() - LINKEDIN_ACTION_CLAIM_LEASE_MS,
    );
    const actionExpiredBefore = new Date(
      now.getTime() - LINKEDIN_ACTION_MAX_AGE_MS,
    );
    const [expiredClaims, expiredScheduledActions] = await Promise.all([
      linkedinActionRepository.find({
        where: [
          {
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt: LessThan(claimExpiredBefore),
            executedAt: IsNull(),
          },
          {
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt: LessThan(claimExpiredBefore),
            executedAt: LessThanOrEqual(claimExpiredBefore),
          },
        ],
        order: { updatedAt: 'ASC', id: 'ASC' },
        take: SEQUENCE_SCHEDULER_BATCH_SIZE,
      }),
      linkedinActionRepository.find({
        where: {
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          scheduledAt: LessThan(actionExpiredBefore),
        },
        order: { scheduledAt: 'ASC' },
        take: SEQUENCE_SCHEDULER_BATCH_SIZE,
      }),
    ]);
    const sequenceEnrollmentIds = [
      ...new Set(
        [...expiredClaims, ...expiredScheduledActions]
          .map(({ sequenceEnrollmentId }) => sequenceEnrollmentId)
          .filter(isDefined),
      ),
    ];
    const sequenceIdByEnrollmentId = new Map<string, string>();

    if (sequenceEnrollmentIds.length > 0) {
      const enrollments = await enrollmentRepository.find({
        where: { id: In(sequenceEnrollmentIds) },
        withDeleted: true,
        select: ['id', 'sequenceId'],
      });

      for (const enrollment of enrollments) {
        sequenceIdByEnrollmentId.set(enrollment.id, enrollment.sequenceId);
      }
    }

    for (const action of expiredClaims) {
      const sequenceId = isDefined(action.sequenceEnrollmentId)
        ? sequenceIdByEnrollmentId.get(action.sequenceEnrollmentId)
        : undefined;

      if (isDefined(sequenceId) && isDefined(action.sequenceEnrollmentId)) {
        await this.sweepSequenceLinkedClaim({
          workspaceId,
          action,
          actionExpiredBefore: claimExpiredBefore,
          enrollmentId: action.sequenceEnrollmentId,
          enrollmentRepository,
          linkedinActionRepository,
          sequenceId,
          sequenceRepository,
          now,
        });

        continue;
      }

      await this.sweepUnlinkedClaim({
        workspaceId,
        action,
        actionExpiredBefore: claimExpiredBefore,
        linkedinActionRepository,
        now,
      });
    }

    for (const action of expiredScheduledActions) {
      const sequenceId = isDefined(action.sequenceEnrollmentId)
        ? sequenceIdByEnrollmentId.get(action.sequenceEnrollmentId)
        : undefined;

      if (isDefined(sequenceId) && isDefined(action.sequenceEnrollmentId)) {
        await this.sweepSequenceLinkedScheduledAction({
          action,
          actionExpiredBefore,
          enrollmentId: action.sequenceEnrollmentId,
          enrollmentRepository,
          linkedinActionRepository,
          sequenceId,
          sequenceRepository,
          now,
        });

        continue;
      }

      await linkedinActionRepository.update(
        {
          id: action.id,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          scheduledAt: LessThanOrEqual(actionExpiredBefore),
        },
        {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          executedAt: null,
          errorMessage:
            SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
        },
      );
    }
  }

  private async sweepUnlinkedClaim({
    workspaceId,
    action,
    actionExpiredBefore,
    linkedinActionRepository,
    now,
  }: {
    workspaceId: string;
    action: LinkedinActionWorkspaceEntity;
    actionExpiredBefore: Date;
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    await workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const lockedAction = await linkedinActionRepository.findOne(
        {
          where: [
            {
              id: action.id,
              sequenceEnrollmentId: IsNull(),
              sequenceStepId: IsNull(),
              status: LINKEDIN_ACTION_STATUSES.CLAIMED,
              claimedAt: LessThanOrEqual(actionExpiredBefore),
              executedAt: IsNull(),
            },
            {
              id: action.id,
              sequenceEnrollmentId: IsNull(),
              sequenceStepId: IsNull(),
              status: LINKEDIN_ACTION_STATUSES.CLAIMED,
              claimedAt: LessThanOrEqual(actionExpiredBefore),
              executedAt: LessThanOrEqual(actionExpiredBefore),
            },
          ],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(lockedAction) || !isDefined(lockedAction.claimedAt)) {
        return;
      }

      const providerWasStarted = isDefined(lockedAction.executedAt);
      const isMessageWithUnknownOutcome =
        providerWasStarted &&
        lockedAction.type === LINKEDIN_ACTION_TYPES.SEND_MESSAGE;
      const ownerWorkspaceMemberId = lockedAction.ownerWorkspaceMemberId;
      let rescheduledAt: Date | null = null;

      if (
        !isMessageWithUnknownOutcome &&
        lockedAction.attemptCount <
          SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT &&
        isDefined(ownerWorkspaceMemberId)
      ) {
        rescheduledAt = await this.sequenceLinkedinThrottleService.reserveSlot({
          workspaceId,
          ownerWorkspaceMemberId,
          settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
          now,
          transactionManager: workspaceTransactionManager,
          excludedActionId: lockedAction.id,
        });
      }

      const shouldRequeue = isDefined(rescheduledAt);

      await linkedinActionRepository.update(
        {
          id: lockedAction.id,
          sequenceEnrollmentId: IsNull(),
          sequenceStepId: IsNull(),
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt: lockedAction.claimedAt,
          executedAt: isDefined(lockedAction.executedAt)
            ? lockedAction.executedAt
            : IsNull(),
        },
        {
          status: shouldRequeue
            ? LINKEDIN_ACTION_STATUSES.SCHEDULED
            : LINKEDIN_ACTION_STATUSES.FAILED,
          claimedAt: null,
          claimedBy: null,
          attemptCount: lockedAction.attemptCount + 1,
          ...(isDefined(rescheduledAt)
            ? {
                scheduledAt: rescheduledAt,
                executedAt: null,
                errorMessage: null,
              }
            : {
                executedAt: providerWasStarted ? now : null,
                errorMessage: isMessageWithUnknownOutcome
                  ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_OUTCOME_UNKNOWN
                  : providerWasStarted
                    ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_EXPIRED
                    : SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
              }),
        },
        workspaceTransactionManager,
      );
    });
  }

  private async sweepSequenceLinkedClaim({
    workspaceId,
    action,
    actionExpiredBefore,
    enrollmentId,
    enrollmentRepository,
    linkedinActionRepository,
    sequenceId,
    sequenceRepository,
    now,
  }: {
    workspaceId: string;
    action: LinkedinActionWorkspaceEntity;
    actionExpiredBefore: Date;
    enrollmentId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    sequenceId: string;
    sequenceRepository: WorkspaceRepository<SequenceWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    await workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const sequence = await sequenceRepository.findOne(
        {
          where: { id: sequenceId },
          withDeleted: true,
          select: ['id', 'status', 'settings', 'deletedAt'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(sequence)) {
        return;
      }

      const enrollment = await enrollmentRepository.findOne(
        {
          where: { id: enrollmentId, sequenceId: sequence.id },
          withDeleted: true,
          select: ['id', 'status', 'waitingOn', 'currentStepId'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(enrollment)) {
        return;
      }

      const lockedAction = await linkedinActionRepository.findOne(
        {
          where: [
            {
              id: action.id,
              sequenceEnrollmentId: enrollment.id,
              status: LINKEDIN_ACTION_STATUSES.CLAIMED,
              claimedAt: LessThanOrEqual(actionExpiredBefore),
              executedAt: IsNull(),
            },
            {
              id: action.id,
              sequenceEnrollmentId: enrollment.id,
              status: LINKEDIN_ACTION_STATUSES.CLAIMED,
              claimedAt: LessThanOrEqual(actionExpiredBefore),
              executedAt: LessThanOrEqual(actionExpiredBefore),
            },
          ],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(lockedAction) || !isDefined(lockedAction.claimedAt)) {
        return;
      }

      const providerWasStarted = isDefined(lockedAction.executedAt);
      const isMessageWithUnknownOutcome =
        providerWasStarted &&
        lockedAction.type === LINKEDIN_ACTION_TYPES.SEND_MESSAGE;

      const enrollmentStillWaitsForAction =
        enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE &&
        enrollment.waitingOn === SEQUENCE_WAITING_ON.LINKEDIN_ACTION &&
        enrollment.currentStepId === lockedAction.sequenceStepId;

      // Terminal enrollment cleanup deliberately leaves runner-owned claims
      // alone so a live runner can report its real outcome. If that runner is
      // lost and its lease later expires, fail rather than requeue: messages
      // may already have sent, while idempotent work is no longer wanted once
      // the enrollment has moved on.
      if (!enrollmentStillWaitsForAction) {
        await linkedinActionRepository.update(
          {
            id: lockedAction.id,
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt: LessThanOrEqual(actionExpiredBefore),
            executedAt: isDefined(lockedAction.executedAt)
              ? LessThanOrEqual(actionExpiredBefore)
              : IsNull(),
          },
          {
            status: LINKEDIN_ACTION_STATUSES.FAILED,
            claimedAt: null,
            claimedBy: null,
            attemptCount: lockedAction.attemptCount + 1,
            executedAt: providerWasStarted ? now : null,
            errorMessage: isMessageWithUnknownOutcome
              ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_OUTCOME_UNKNOWN
              : providerWasStarted
                ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_EXPIRED
                : SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
          },
          workspaceTransactionManager,
        );

        return;
      }

      // A safe-to-retry browser action stays owned while paused. Releasing it
      // here would make it runnable even though the custom claim gate rejects
      // new work. The first tick after resume requeues it under the same lock.
      const sequenceCanRun =
        sequence.status === SEQUENCE_STATUSES.ACTIVE &&
        !isDefined(sequence.deletedAt);

      if (!sequenceCanRun && !isMessageWithUnknownOutcome) {
        // claimedAt is the runner's immutable CAS token. Rotate the preserved
        // paused claim using updatedAt so a full batch cannot hide expired
        // active or unknown-outcome claims behind it forever.
        await linkedinActionRepository.update(
          {
            id: lockedAction.id,
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt: lockedAction.claimedAt,
            executedAt: isDefined(lockedAction.executedAt)
              ? lockedAction.executedAt
              : IsNull(),
          },
          { updatedAt: now.toISOString() },
          workspaceTransactionManager,
        );

        return;
      }

      const ownerWorkspaceMemberId = lockedAction.ownerWorkspaceMemberId;
      let shouldRequeue = false;
      let rescheduledAt: Date | null = null;

      if (
        sequenceCanRun &&
        !isMessageWithUnknownOutcome &&
        lockedAction.attemptCount <
          SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT &&
        isDefined(ownerWorkspaceMemberId)
      ) {
        shouldRequeue = true;
        rescheduledAt = await this.sequenceLinkedinThrottleService.reserveSlot({
          workspaceId,
          ownerWorkspaceMemberId,
          settings: parseSequenceSettings(sequence.settings),
          now,
          transactionManager: workspaceTransactionManager,
          excludedActionId: lockedAction.id,
        });
      }

      await linkedinActionRepository.update(
        {
          id: lockedAction.id,
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt: LessThanOrEqual(actionExpiredBefore),
          executedAt: isDefined(lockedAction.executedAt)
            ? LessThanOrEqual(actionExpiredBefore)
            : IsNull(),
        },
        {
          status: shouldRequeue
            ? LINKEDIN_ACTION_STATUSES.SCHEDULED
            : LINKEDIN_ACTION_STATUSES.FAILED,
          claimedAt: null,
          claimedBy: null,
          attemptCount: lockedAction.attemptCount + 1,
          ...(isDefined(rescheduledAt) ? { scheduledAt: rescheduledAt } : {}),
          ...(shouldRequeue
            ? { executedAt: null }
            : {
                executedAt: providerWasStarted ? now : null,
                errorMessage: isMessageWithUnknownOutcome
                  ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_OUTCOME_UNKNOWN
                  : providerWasStarted
                    ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_EXPIRED
                    : SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
              }),
        },
        workspaceTransactionManager,
      );
    });
  }

  private async sweepSequenceLinkedScheduledAction({
    action,
    actionExpiredBefore,
    enrollmentId,
    enrollmentRepository,
    linkedinActionRepository,
    sequenceId,
    sequenceRepository,
    now,
  }: {
    action: LinkedinActionWorkspaceEntity;
    actionExpiredBefore: Date;
    enrollmentId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    sequenceId: string;
    sequenceRepository: WorkspaceRepository<SequenceWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    await workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const sequence = await sequenceRepository.findOne(
        {
          where: { id: sequenceId },
          withDeleted: true,
          select: ['id', 'status'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(sequence)) {
        return;
      }

      const enrollment = await enrollmentRepository.findOne(
        {
          where: { id: enrollmentId, sequenceId: sequence.id },
          withDeleted: true,
          select: ['id', 'currentStepId'],
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(enrollment)) {
        return;
      }

      const lockedAction = await linkedinActionRepository.findOne(
        {
          where: {
            id: action.id,
            sequenceEnrollmentId: enrollment.id,
            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
            scheduledAt: LessThanOrEqual(actionExpiredBefore),
          },
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(lockedAction)) {
        return;
      }

      const isPaused = sequence.status === SEQUENCE_STATUSES.PAUSED;
      const updateResult = await linkedinActionRepository.update(
        {
          id: lockedAction.id,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          scheduledAt: LessThanOrEqual(actionExpiredBefore),
        },
        isPaused
          ? {
              status: LINKEDIN_ACTION_STATUSES.CANCELLED,
              claimedAt: null,
              claimedBy: null,
              executedAt: now,
              errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
            }
          : {
              status: LINKEDIN_ACTION_STATUSES.FAILED,
              executedAt: null,
              errorMessage:
                SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
            },
        workspaceTransactionManager,
      );

      if (isPaused && updateResult.affected === 1) {
        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            currentStepId: isDefined(lockedAction.sequenceStepId)
              ? lockedAction.sequenceStepId
              : IsNull(),
          },
          {
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            nextActionAt: now,
          },
          workspaceTransactionManager,
        );
      }
    });
  }

  // Enrollments waiting on a LinkedIn action are woken by an update event on
  // that action. That event is in-process and fire-and-forget: a worker restart,
  // a failed handler, or an action deleted underneath the enrollment leaves it
  // ACTIVE with waitingOn=LINKEDIN_ACTION and nextActionAt=null, which no other
  // query in this service ever selects. This pass re-derives the outcome from
  // the action itself so the event stays an optimisation rather than the only
  // path forward.
  private async reconcileLinkedinWaitingEnrollments({
    workspaceId,
    enrollmentRepository,
    linkedinActionRepository,
    now,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    // Only enrollments that have been waiting for a while are reconciled, so a
    // transition that is still settling is never mistaken for a stuck one.
    const waitingEnrollments = await enrollmentRepository.find({
      where: {
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        updatedAt: LessThan(
          new Date(
            now.getTime() - SEQUENCE_LINKEDIN_RECONCILE_GRACE_MS,
          ).toISOString(),
        ),
      },
      order: { updatedAt: 'ASC' },
      take: SEQUENCE_SCHEDULER_BATCH_SIZE,
    });

    if (waitingEnrollments.length === 0) {
      return;
    }

    const actions = await linkedinActionRepository.find({
      where: {
        sequenceEnrollmentId: In(
          waitingEnrollments.map((enrollment) => enrollment.id),
        ),
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const actionsByEnrollmentId = new Map<
      string,
      LinkedinActionWorkspaceEntity[]
    >();

    for (const action of actions) {
      if (!isDefined(action.sequenceEnrollmentId)) {
        continue;
      }

      const enrollmentActions =
        actionsByEnrollmentId.get(action.sequenceEnrollmentId) ?? [];

      enrollmentActions.push(action);
      actionsByEnrollmentId.set(action.sequenceEnrollmentId, enrollmentActions);
    }

    for (const enrollment of waitingEnrollments) {
      const waitingSnapshot = {
        id: enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        currentStepId: isDefined(enrollment.currentStepId)
          ? enrollment.currentStepId
          : IsNull(),
        updatedAt: dateAtMillisecondPrecisionFindOperator(enrollment.updatedAt),
      };
      const enrollmentActions = actionsByEnrollmentId.get(enrollment.id) ?? [];
      const stepActions = isDefined(enrollment.currentStepId)
        ? enrollmentActions.filter(
            (action) => action.sequenceStepId === enrollment.currentStepId,
          )
        : enrollmentActions;

      if (
        stepActions.some(
          (action) =>
            action.status === LINKEDIN_ACTION_STATUSES.SCHEDULED ||
            action.status === LINKEDIN_ACTION_STATUSES.CLAIMED,
        )
      ) {
        // This repair pass is deliberately bounded. Rotate healthy open waits
        // to the back so one full page of long-lived scheduled actions cannot
        // permanently hide a later enrollment whose terminal event was lost.
        // The CAS keeps a concurrent reply/pause/step transition authoritative.
        await enrollmentRepository.update(waitingSnapshot, {
          updatedAt: now.toISOString(),
        });

        continue;
      }

      const latestAction = stepActions[stepActions.length - 1];
      const shouldAdvance =
        isDefined(latestAction) &&
        (latestAction.status === LINKEDIN_ACTION_STATUSES.COMPLETED ||
          latestAction.status === LINKEDIN_ACTION_STATUSES.SKIPPED);
      const shouldRetryPausedStep =
        latestAction?.status === LINKEDIN_ACTION_STATUSES.CANCELLED &&
        latestAction.errorMessage === SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR;

      if (shouldAdvance || shouldRetryPausedStep) {
        if (shouldAdvance) {
          // Terminal action events are an optimisation, not a durable queue.
          // Replay reply attribution before the repair CAS so a missed event
          // cannot advance past an already-persisted inbound reply.
          try {
            await this.sequenceLinkedinReplyListener.reconcileEnrollmentBeforeProviderStart(
              {
                sequenceEnrollmentId: enrollment.id,
                workspaceId,
              },
            );
          } catch (error) {
            // Reply verification is a safety gate for this enrollment, not a
            // reason to suppress unrelated due work. Keep the waiter in place
            // and rotate this exact snapshot behind the bounded repair page.
            this.logger.error(
              `Failed to reconcile LinkedIn replies for enrollment ${enrollment.id}`,
              error instanceof Error ? error.stack : undefined,
            );
            await enrollmentRepository.update(waitingSnapshot, {
              updatedAt: now.toISOString(),
            });

            continue;
          }
        }

        const updateResult = await enrollmentRepository.update(
          waitingSnapshot,
          {
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            nextActionAt: now,
          },
        );

        if (updateResult.affected === 1) {
          await this.sequenceQueueService.enqueueProcess({
            workspaceId,
            enrollmentId: enrollment.id,
          });
        }

        continue;
      }

      const errorMessage =
        latestAction?.errorMessage ??
        (isDefined(latestAction)
          ? SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_EXPIRED
          : SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_MISSING);

      await enrollmentRepository.update(waitingSnapshot, {
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        waitingOn: null,
        nextActionAt: null,
        endedAt: now,
        errorMessage,
      });
    }
  }

  private async reconcileTaskWaitingEnrollments({
    workspaceId,
    enrollmentRepository,
    now,
  }: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const waitingEnrollments = await enrollmentRepository.find({
      where: {
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: In([
          SEQUENCE_WAITING_ON.TASK_DONE,
          SEQUENCE_WAITING_ON.TASK_DEADLINE,
        ]),
        updatedAt: LessThan(
          new Date(
            now.getTime() - SEQUENCE_TASK_RECONCILE_GRACE_MS,
          ).toISOString(),
        ),
      },
      order: { updatedAt: 'ASC' },
      take: SEQUENCE_SCHEDULER_BATCH_SIZE,
    });

    if (waitingEnrollments.length === 0) {
      return;
    }

    const taskRepository = await this.globalWorkspaceOrmManager.getRepository(
      workspaceId,
      TaskWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const tasks = await taskRepository.find({
      where: {
        sequenceEnrollmentId: In(
          waitingEnrollments.map((enrollment) => enrollment.id),
        ),
      },
      select: ['id', 'sequenceEnrollmentId', 'sequenceStepId', 'status'],
    });

    for (const enrollment of waitingEnrollments) {
      if (!isDefined(enrollment.currentStepId)) {
        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepId: IsNull(),
            waitingOn: In([
              SEQUENCE_WAITING_ON.TASK_DONE,
              SEQUENCE_WAITING_ON.TASK_DEADLINE,
            ]),
            updatedAt: dateAtMillisecondPrecisionFindOperator(
              enrollment.updatedAt,
            ),
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: now,
            errorMessage: SEQUENCE_EXECUTION_ERROR.SEQUENCE_TASK_STEP_MISSING,
          },
        );

        continue;
      }

      const currentStepTasks = tasks.filter(
        (task) =>
          task.sequenceEnrollmentId === enrollment.id &&
          task.sequenceStepId === enrollment.currentStepId,
      );
      const completedTask = currentStepTasks.find(
        (task) => task.status === 'DONE',
      );

      if (isDefined(completedTask)) {
        await this.sequenceTaskCompletionService.completeTaskStep({
          workspaceId,
          enrollmentId: enrollment.id,
          stepId: enrollment.currentStepId,
          taskId: completedTask.id,
        });

        continue;
      }

      if (currentStepTasks.length === 0) {
        await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            currentStepId: enrollment.currentStepId,
            waitingOn: In([
              SEQUENCE_WAITING_ON.TASK_DONE,
              SEQUENCE_WAITING_ON.TASK_DEADLINE,
            ]),
            updatedAt: dateAtMillisecondPrecisionFindOperator(
              enrollment.updatedAt,
            ),
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: now,
            errorMessage: SEQUENCE_EXECUTION_ERROR.SEQUENCE_TASK_MISSING,
          },
        );

        continue;
      }

      // Present, unfinished tasks are healthy. Move them behind older repair
      // candidates so the bounded page eventually reaches every waiter. An
      // updatedAt-only event is ignored by the status-change listener.
      await enrollmentRepository.update(
        {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepId: enrollment.currentStepId,
          waitingOn: In([
            SEQUENCE_WAITING_ON.TASK_DONE,
            SEQUENCE_WAITING_ON.TASK_DEADLINE,
          ]),
          updatedAt: dateAtMillisecondPrecisionFindOperator(
            enrollment.updatedAt,
          ),
        },
        { updatedAt: now.toISOString() },
      );
    }
  }

  private async reconcileStaleSequenceMetrics({
    workspaceId,
    sequenceRepository,
    now,
  }: {
    workspaceId: string;
    sequenceRepository: WorkspaceRepository<SequenceWorkspaceEntity>;
    now: Date;
  }): Promise<void> {
    const staleSequences = await sequenceRepository.find({
      where: {
        updatedAt: LessThan(
          new Date(
            now.getTime() - SEQUENCE_METRICS_RECONCILE_GRACE_MS,
          ).toISOString(),
        ),
      },
      select: ['id'],
      withDeleted: true,
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: SEQUENCE_METRICS_RECONCILE_BATCH_SIZE,
    });

    // Event-driven recomputes keep counters fresh in the common path. This
    // bounded database-backed rotation repairs a lost fire-and-forget event;
    // each recompute refreshes updatedAt, so quiet sequences move to the back
    // without a Redis cursor or an unbounded scan.
    for (const sequence of staleSequences) {
      try {
        await this.sequenceMetricsService.recomputeForSequenceInCurrentContext({
          workspaceId,
          sequenceId: sequence.id,
        });
      } catch (error) {
        // Metrics are reporting state, never a reason to stop due outreach
        // scheduling. A later rotation retries the same durable source rows.
        this.logger.error(
          `Failed to reconcile metrics for sequence ${sequence.id}`,
          error instanceof Error ? error.stack : undefined,
        );

        try {
          await sequenceRepository.update(
            {
              id: sequence.id,
              updatedAt: LessThan(
                new Date(
                  now.getTime() - SEQUENCE_METRICS_RECONCILE_GRACE_MS,
                ).toISOString(),
              ),
            },
            { updatedAt: now.toISOString() },
          );
        } catch (rotationError) {
          this.logger.error(
            `Failed to rotate metrics repair candidate ${sequence.id}`,
            rotationError instanceof Error ? rotationError.stack : undefined,
          );
        }
      }
    }
  }

  private async admitPendingEnrollments({
    enrollmentRepository,
    sequenceRepository,
    sequence,
    now,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    sequenceRepository: WorkspaceRepository<SequenceWorkspaceEntity>;
    sequence: SequenceWorkspaceEntity;
    now: Date;
  }): Promise<void> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    await workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const lockedSequence = await sequenceRepository.findOne(
        {
          where: {
            id: sequence.id,
            status: SEQUENCE_STATUSES.ACTIVE,
          },
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!lockedSequence) {
        return;
      }

      const lockedSettings = parseSequenceSettings(lockedSequence.settings);

      let remainingStarts = SEQUENCE_SCHEDULER_BATCH_SIZE;

      if (lockedSettings.dailyStartLimitEnabled) {
        const quotaTimeZone = isRecipientSequenceEmailWindow(lockedSettings)
          ? 'UTC'
          : lockedSettings.timezone;
        const startedToday = await enrollmentRepository.count(
          {
            where: {
              sequenceId: sequence.id,
              startedAt: MoreThanOrEqual(
                startOfDayInTimezone(now, quotaTimeZone),
              ),
            },
          },
          workspaceTransactionManager,
        );

        remainingStarts = Math.max(
          0,
          lockedSettings.dailyStarts - startedToday,
        );
      }

      if (remainingStarts === 0) {
        return;
      }

      const pendingEnrollments = await enrollmentRepository.find(
        {
          where: {
            sequenceId: sequence.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
          },
          order: { createdAt: 'ASC' },
          take: Math.min(remainingStarts, SEQUENCE_SCHEDULER_BATCH_SIZE),
        },
        workspaceTransactionManager,
      );
      const senderPool = this.getEffectiveSenderPool({
        sequence: lockedSequence,
        settings: lockedSettings,
      });
      const hasExplicitSenderPool =
        (lockedSettings.senderConnectedAccountIds?.length ?? 0) > 0;
      const activeSenderAssignments =
        senderPool.length > 1
          ? await enrollmentRepository.find(
              {
                where: {
                  sequenceId: sequence.id,
                  status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                  senderConnectedAccountId: In(senderPool),
                },
                select: { senderConnectedAccountId: true },
              },
              workspaceTransactionManager,
            )
          : [];
      const assignmentCountBySenderId = new Map(
        senderPool.map((senderConnectedAccountId) => [
          senderConnectedAccountId,
          activeSenderAssignments.filter(
            (enrollment) =>
              enrollment.senderConnectedAccountId === senderConnectedAccountId,
          ).length,
        ]),
      );

      for (const enrollment of pendingEnrollments) {
        const senderConnectedAccountId =
          !hasExplicitSenderPool &&
          isDefined(enrollment.senderConnectedAccountId) &&
          senderPool.includes(enrollment.senderConnectedAccountId)
            ? enrollment.senderConnectedAccountId
            : this.getLeastLoadedSender({
                senderPool,
                assignmentCountBySenderId,
              });

        const updateResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            startedAt: now,
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            nextActionAt: now,
            senderConnectedAccountId,
          },
          workspaceTransactionManager,
        );

        if (
          updateResult.affected === 1 &&
          isDefined(senderConnectedAccountId)
        ) {
          assignmentCountBySenderId.set(
            senderConnectedAccountId,
            (assignmentCountBySenderId.get(senderConnectedAccountId) ?? 0) + 1,
          );
        }
      }
    });
  }

  private getEffectiveSenderPool({
    sequence,
    settings,
  }: {
    sequence: SequenceWorkspaceEntity;
    settings: SequenceSettings;
  }): string[] {
    if ((settings.senderConnectedAccountIds?.length ?? 0) > 0) {
      return settings.senderConnectedAccountIds ?? [];
    }

    return isDefined(sequence.senderConnectedAccountId)
      ? [sequence.senderConnectedAccountId]
      : [];
  }

  private getLeastLoadedSender({
    senderPool,
    assignmentCountBySenderId,
  }: {
    senderPool: string[];
    assignmentCountBySenderId: Map<string, number>;
  }): string | null {
    return (
      senderPool.reduce<string | null>((leastLoadedSenderId, senderId) => {
        if (!isDefined(leastLoadedSenderId)) {
          return senderId;
        }

        return (assignmentCountBySenderId.get(senderId) ?? 0) <
          (assignmentCountBySenderId.get(leastLoadedSenderId) ?? 0)
          ? senderId
          : leastLoadedSenderId;
      }, null) ?? null
    );
  }

  private async allocateMailboxSlots({
    workspaceId,
    mailboxId,
    dueEmails,
    enrollmentRepository,
    activeSequenceIds,
    now,
  }: {
    workspaceId: string;
    mailboxId: string;
    dueEmails: DueEmail[];
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    activeSequenceIds: string[];
    now: Date;
  }): Promise<void> {
    const sendLockToken =
      await this.sequenceMailboxThrottleService.acquireSendLock({
        workspaceId,
        mailboxId,
      });

    if (!isDefined(sendLockToken)) {
      return;
    }

    try {
      await this.allocateMailboxSlotsUnderLock({
        workspaceId,
        mailboxId,
        dueEmails,
        enrollmentRepository,
        activeSequenceIds,
        now,
      });
    } finally {
      await this.sequenceMailboxThrottleService.releaseSendLock({
        workspaceId,
        mailboxId,
        token: sendLockToken,
      });
    }
  }

  private async allocateMailboxSlotsUnderLock({
    workspaceId,
    mailboxId,
    dueEmails,
    enrollmentRepository,
    activeSequenceIds,
    now,
  }: {
    workspaceId: string;
    mailboxId: string;
    dueEmails: DueEmail[];
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    activeSequenceIds: string[];
    now: Date;
  }): Promise<void> {
    const staggerMinutes = Math.max(
      0,
      ...dueEmails.map(({ settings }) => settings.staggerMinutes),
    );
    const staggerMilliseconds = staggerMinutes * 60 * 1000;
    const lastSendAt = await this.sequenceMailboxThrottleService.getLastSendAt({
      workspaceId,
      mailboxId,
      enrollmentRepository,
    });
    let nextAvailableAt = new Date(
      Math.max(
        now.getTime(),
        (lastSendAt?.getTime() ?? now.getTime() - staggerMilliseconds) +
          staggerMilliseconds,
      ),
    );
    const alreadyScheduled = dueEmails
      .filter(
        ({ enrollment }) =>
          enrollment.waitingOn === SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      )
      .sort(
        (left, right) =>
          this.toTimestamp(left.enrollment.nextActionAt) -
          this.toTimestamp(right.enrollment.nextActionAt),
      );
    const newlyDue = dueEmails
      .filter(
        ({ enrollment }) =>
          enrollment.waitingOn !== SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      )
      .sort(
        (left, right) =>
          this.toTimestamp(left.enrollment.nextActionAt) -
          this.toTimestamp(right.enrollment.nextActionAt),
      );

    const futureScheduledSlots = await this.getFutureScheduledSlots({
      mailboxId,
      enrollmentRepository,
      activeSequenceIds,
      now,
    });

    for (const dueEmail of alreadyScheduled) {
      const allocation = await this.allocateSlot({
        workspaceId,
        dueEmail,
        enrollmentRepository,
        now,
        slot: nextAvailableAt,
      });

      if (allocation.wasRequestedSlotUsed) {
        nextAvailableAt = new Date(
          allocation.effectiveSlot.getTime() + staggerMilliseconds,
        );
      } else {
        futureScheduledSlots.push(allocation.effectiveSlot);
      }
    }

    for (const dueEmail of newlyDue) {
      const availableSlot = this.findNextAvailableSlot({
        candidate: nextAvailableAt,
        reservedSlots: futureScheduledSlots,
        staggerMilliseconds,
      });
      const allocation = await this.allocateSlot({
        workspaceId,
        dueEmail,
        enrollmentRepository,
        now,
        slot: availableSlot,
      });

      futureScheduledSlots.push(allocation.effectiveSlot);

      if (allocation.wasRequestedSlotUsed) {
        nextAvailableAt = new Date(
          allocation.effectiveSlot.getTime() + staggerMilliseconds,
        );
      }
    }
  }

  private async allocateSlot({
    workspaceId,
    dueEmail,
    enrollmentRepository,
    now,
    slot,
  }: {
    workspaceId: string;
    dueEmail: DueEmail;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    now: Date;
    slot: Date;
  }): Promise<{ effectiveSlot: Date; wasRequestedSlotUsed: boolean }> {
    const wasRequestedSlotUsed = isWithinSendingWindow(slot, dueEmail.settings);
    const effectiveSlot = wasRequestedSlotUsed
      ? slot
      : nextWindowOpen(slot, dueEmail.settings);
    const authorizationResult = await enrollmentRepository.update(
      {
        id: dueEmail.enrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepPosition: dueEmail.enrollment.currentStepPosition,
        currentStepId: isDefined(dueEmail.enrollment.currentStepId)
          ? dueEmail.enrollment.currentStepId
          : IsNull(),
        waitingOn: dueEmail.enrollment.waitingOn ?? IsNull(),
        nextActionAt: LessThanOrEqual(now),
      },
      {
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: effectiveSlot,
      },
    );

    if (authorizationResult.affected !== 1) {
      return { effectiveSlot, wasRequestedSlotUsed };
    }

    if (
      effectiveSlot.getTime() <=
      now.getTime() + SEQUENCE_SEND_SLOT_LOOKAHEAD_MILLISECONDS
    ) {
      await this.sequenceQueueService.enqueueProcess({
        workspaceId,
        enrollmentId: dueEmail.enrollment.id,
      });

      return { effectiveSlot, wasRequestedSlotUsed };
    }

    return { effectiveSlot, wasRequestedSlotUsed };
  }

  private groupStepsBySequenceId(
    steps: SequenceStepWorkspaceEntity[],
  ): Map<string, SequenceStepWorkspaceEntity[]> {
    const stepsBySequenceId = new Map<string, SequenceStepWorkspaceEntity[]>();

    for (const step of steps) {
      const sequenceSteps = stepsBySequenceId.get(step.sequenceId) ?? [];

      sequenceSteps.push(step);
      stepsBySequenceId.set(step.sequenceId, sequenceSteps);
    }

    return stepsBySequenceId;
  }

  private async getPausedLinkedinRetryEnrollmentIds({
    enrollments,
    linkedinActionRepository,
    stepsBySequenceId,
  }: {
    enrollments: SequenceEnrollmentWorkspaceEntity[];
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    stepsBySequenceId: Map<string, SequenceStepWorkspaceEntity[]>;
  }): Promise<Set<string>> {
    const currentStepIdByEnrollmentId = new Map<string, string>();

    for (const enrollment of enrollments) {
      const currentStep = (
        stepsBySequenceId.get(enrollment.sequenceId) ?? []
      ).find((step) => step.id === enrollment.currentStepId);

      if (
        currentStep?.settings.type ===
          SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST ||
        currentStep?.settings.type ===
          SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE ||
        currentStep?.settings.type ===
          SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST
      ) {
        currentStepIdByEnrollmentId.set(enrollment.id, currentStep.id);
      }
    }

    if (currentStepIdByEnrollmentId.size === 0) {
      return new Set();
    }

    const actions = await linkedinActionRepository.find({
      where: {
        sequenceEnrollmentId: In([...currentStepIdByEnrollmentId.keys()]),
        sequenceStepId: In([...currentStepIdByEnrollmentId.values()]),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      select: [
        'createdAt',
        'errorMessage',
        'id',
        'sequenceEnrollmentId',
        'sequenceStepId',
        'status',
      ],
    });
    const inspectedEnrollmentIds = new Set<string>();
    const pausedRetryEnrollmentIds = new Set<string>();

    for (const action of actions) {
      if (
        !isDefined(action.sequenceEnrollmentId) ||
        inspectedEnrollmentIds.has(action.sequenceEnrollmentId) ||
        action.sequenceStepId !==
          currentStepIdByEnrollmentId.get(action.sequenceEnrollmentId)
      ) {
        continue;
      }

      inspectedEnrollmentIds.add(action.sequenceEnrollmentId);

      if (
        action.status === LINKEDIN_ACTION_STATUSES.CANCELLED &&
        action.errorMessage === SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR
      ) {
        pausedRetryEnrollmentIds.add(action.sequenceEnrollmentId);
      }
    }

    return pausedRetryEnrollmentIds;
  }

  private async getFutureScheduledSlots({
    mailboxId,
    enrollmentRepository,
    activeSequenceIds,
    now,
  }: {
    mailboxId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    activeSequenceIds: string[];
    now: Date;
  }): Promise<Date[]> {
    const scheduledEnrollments = await enrollmentRepository.find({
      where: {
        senderConnectedAccountId: mailboxId,
        sequenceId: In(activeSequenceIds),
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: MoreThan(now),
      },
      order: { nextActionAt: 'ASC' },
      select: { nextActionAt: true },
    });

    return scheduledEnrollments
      .map(({ nextActionAt }) => nextActionAt)
      .filter(isDefined);
  }

  private findNextAvailableSlot({
    candidate,
    reservedSlots,
    staggerMilliseconds,
  }: {
    candidate: Date;
    reservedSlots: Date[];
    staggerMilliseconds: number;
  }): Date {
    let candidateTimestamp = candidate.getTime();
    const reservationTimestamps = reservedSlots
      .map((slot) => slot.getTime())
      .sort((left, right) => left - right);

    for (const reservationTimestamp of reservationTimestamps) {
      if (reservationTimestamp < candidateTimestamp) {
        if (candidateTimestamp - reservationTimestamp < staggerMilliseconds) {
          candidateTimestamp = reservationTimestamp + staggerMilliseconds;
        }

        continue;
      }

      if (reservationTimestamp - candidateTimestamp >= staggerMilliseconds) {
        break;
      }

      candidateTimestamp = reservationTimestamp + staggerMilliseconds;
    }

    return new Date(candidateTimestamp);
  }

  private toTimestamp(value: Date | null): number {
    return value?.getTime() ?? 0;
  }
}
