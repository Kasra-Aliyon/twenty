import { Injectable } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceSettings,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
} from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  LINKEDIN_ACTION_CLAIM_LEASE_MS,
  LINKEDIN_ACTION_MAX_AGE_MS,
  SEQUENCE_SCHEDULER_BATCH_SIZE,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_SEND_SLOT_LOOKAHEAD_MILLISECONDS,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import {
  isWithinSendingWindow,
  nextWindowOpen,
  startOfDayInTimezone,
} from 'src/modules/sequence/utils/sequence-window.util';

type DueEmail = {
  enrollment: SequenceEnrollmentWorkspaceEntity;
  settings: SequenceSettings;
};

@Injectable()
export class SequenceSchedulerService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
    private readonly sequenceMailboxThrottleService: SequenceMailboxThrottleService,
  ) {}

  async tick(workspaceId: string, now = new Date()): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const linkedinActionRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          LinkedinActionWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      await this.sweepLinkedinActions({ linkedinActionRepository, now });

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
      const stepRepository = await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        SequenceStepWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
      const activeSequences = await sequenceRepository.find({
        where: { status: SEQUENCE_STATUSES.ACTIVE },
      });
      const eligibleSequences = activeSequences
        .map((sequence) => ({
          sequence,
          settings: parseSequenceSettings(sequence.settings),
        }))
        .filter(({ settings }) => isWithinSendingWindow(now, settings));

      if (eligibleSequences.length === 0) {
        return;
      }

      for (const { sequence, settings } of eligibleSequences) {
        await this.admitPendingEnrollments({
          enrollmentRepository,
          sequence,
          settings,
          now,
        });
      }

      const sequenceIds = eligibleSequences.map(({ sequence }) => sequence.id);
      const [dueEnrollments, steps] = await Promise.all([
        enrollmentRepository.find({
          where: {
            sequenceId: In(sequenceIds),
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: In([
              SEQUENCE_WAITING_ON.DELAY,
              SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
              SEQUENCE_WAITING_ON.TASK_DEADLINE,
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
        eligibleSequences.map(({ sequence, settings }) => [
          sequence.id,
          settings,
        ]),
      );
      const senderBySequenceId = new Map(
        eligibleSequences.map(({ sequence }) => [
          sequence.id,
          sequence.senderConnectedAccountId,
        ]),
      );
      const stepsBySequenceId = this.groupStepsBySequenceId(steps);
      const dueEmailsByMailboxId = new Map<string, DueEmail[]>();

      for (const enrollment of dueEnrollments) {
        const nextStep = stepsBySequenceId
          .get(enrollment.sequenceId)
          ?.find((step) => step.position > enrollment.currentStepPosition);
        const settings = settingsBySequenceId.get(enrollment.sequenceId);

        if (
          !isDefined(nextStep) ||
          nextStep.type !== SEQUENCE_STEP_TYPES.SEND_EMAIL ||
          !isDefined(settings)
        ) {
          await this.sequenceQueueService.enqueueProcess({
            workspaceId,
            enrollmentId: enrollment.id,
          });

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

        mailboxEnrollments.push({ enrollment, settings });
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
    }, buildSystemAuthContext(workspaceId));
  }

  private async sweepLinkedinActions({
    linkedinActionRepository,
    now,
  }: {
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
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
        where: {
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt: LessThan(claimExpiredBefore),
        },
        order: { claimedAt: 'ASC' },
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

    for (const action of expiredClaims) {
      await linkedinActionRepository.update(
        {
          id: action.id,
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt: LessThanOrEqual(claimExpiredBefore),
        },
        {
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          claimedAt: null,
          claimedBy: null,
          attemptCount: action.attemptCount + 1,
        },
      );
    }

    for (const action of expiredScheduledActions) {
      await linkedinActionRepository.update(
        {
          id: action.id,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          scheduledAt: LessThanOrEqual(actionExpiredBefore),
        },
        {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          executedAt: now,
          errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_EXPIRED,
        },
      );
    }
  }

  private async admitPendingEnrollments({
    enrollmentRepository,
    sequence,
    settings,
    now,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    sequence: SequenceWorkspaceEntity;
    settings: SequenceSettings;
    now: Date;
  }): Promise<void> {
    const startedToday = await enrollmentRepository.count({
      where: {
        sequenceId: sequence.id,
        startedAt: MoreThanOrEqual(
          startOfDayInTimezone(now, settings.timezone),
        ),
      },
    });
    const remainingStarts = Math.max(0, settings.dailyStarts - startedToday);

    if (remainingStarts === 0) {
      return;
    }

    const pendingEnrollments = await enrollmentRepository.find({
      where: {
        sequenceId: sequence.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      },
      order: { createdAt: 'ASC' },
      take: Math.min(remainingStarts, SEQUENCE_SCHEDULER_BATCH_SIZE),
    });

    for (const enrollment of pendingEnrollments) {
      await enrollmentRepository.update(
        {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        },
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          startedAt: now,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: now,
          senderConnectedAccountId:
            enrollment.senderConnectedAccountId ??
            sequence.senderConnectedAccountId,
        },
      );
    }
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
    const lockAcquired =
      await this.sequenceMailboxThrottleService.acquireSendLock({
        workspaceId,
        mailboxId,
      });

    if (!lockAcquired) {
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
