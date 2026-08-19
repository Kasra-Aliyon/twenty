import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_CONNECTION_STATES,
  type LinkedInActionStatus,
  type LinkedInConnectionState,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IsNull } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type SequenceLinkedinActionMutationResultDTO } from 'src/modules/sequence/dtos/sequence-linkedin-action-mutation-result.dto';
import { type SequenceLinkedinActionReportInput } from 'src/modules/sequence/dtos/sequence-linkedin-action-report.input';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import {
  DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_BASE_MILLISECONDS,
  SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT,
} from 'src/modules/sequence/sequence.constants';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import { isWithinSendingWindow } from 'src/modules/sequence/utils/sequence-window.util';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const REPORTABLE_LINKEDIN_ACTION_STATUSES = new Set<LinkedInActionStatus>([
  LINKEDIN_ACTION_STATUSES.COMPLETED,
  LINKEDIN_ACTION_STATUSES.SKIPPED,
  LINKEDIN_ACTION_STATUSES.FAILED,
]);

const LINKEDIN_CONNECTION_STATE_VALUES = new Set<LinkedInConnectionState>(
  Object.values(LINKEDIN_CONNECTION_STATES),
);

type LockedClaimContext = {
  action: LinkedinActionWorkspaceEntity;
  actionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
  enrollment: SequenceEnrollmentWorkspaceEntity | null;
  enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  sequence: SequenceWorkspaceEntity | null;
  sequenceEnrollmentId: string | null;
  sequenceStepId: string | null;
  transactionManager: WorkspaceEntityManager;
};

@Injectable()
export class SequenceLinkedinActionMutationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceEmailReplyReconciliationService: SequenceEmailReplyReconciliationService,
    private readonly sequenceLinkedinReplyListener: SequenceLinkedinReplyListener,
    private readonly sequenceLinkedinThrottleService: SequenceLinkedinThrottleService,
  ) {}

  async start({
    actionId,
    claimedAt,
    claimedBy,
    now: requestedNow,
    workspaceId,
    workspaceMemberId,
  }: {
    actionId: string;
    claimedAt: Date;
    claimedBy: string;
    now?: Date;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    const didReconcileReply = await this.reconcileRepliesBeforeStart({
      actionId,
      claimedAt,
      claimedBy,
      workspaceId,
      workspaceMemberId,
    });

    if (didReconcileReply) {
      return null;
    }

    return this.withLockedClaim({
      actionId,
      claimedAt,
      claimedBy,
      workspaceId,
      workspaceMemberId,
      operation: async ({
        action,
        actionRepository,
        enrollment,
        sequence,
        sequenceEnrollmentId,
        sequenceStepId,
        transactionManager,
      }) => {
        if (
          isDefined(enrollment) &&
          (isDefined(sequence?.deletedAt) ||
            isDefined(enrollment.deletedAt) ||
            sequence?.status !== SEQUENCE_STATUSES.ACTIVE ||
            enrollment.status !== SEQUENCE_ENROLLMENT_STATUSES.ACTIVE ||
            enrollment.waitingOn !== SEQUENCE_WAITING_ON.LINKEDIN_ACTION ||
            enrollment.currentStepId !== sequenceStepId)
        ) {
          return null;
        }

        // Provider admission is serialized by the same owner row used for
        // pacing and quota reservations. Capture server time only after that
        // lock is held so lock/reply delays cannot cross a UTC day or shorten
        // the next real provider gap.
        const workspaceMemberRepository = transactionManager.getRepository(
          WorkspaceMemberWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
        const owner = await workspaceMemberRepository.findOne({
          where: { id: workspaceMemberId },
          select: ['id'],
          lock: { mode: 'pessimistic_write' },
        });

        if (!isDefined(owner)) {
          throw new Error(`Could not lock LinkedIn owner ${workspaceMemberId}`);
        }

        const providerStartAt = requestedNow ?? new Date();

        const settings = isDefined(sequence)
          ? parseSequenceSettings(sequence.settings)
          : DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS;
        const scheduledUtcDay = Date.UTC(
          action.scheduledAt.getUTCFullYear(),
          action.scheduledAt.getUTCMonth(),
          action.scheduledAt.getUTCDate(),
        );
        const startUtcDay = Date.UTC(
          providerStartAt.getUTCFullYear(),
          providerStartAt.getUTCMonth(),
          providerStartAt.getUTCDate(),
        );

        // Claim-time admission cannot reserve a different UTC day's budget,
        // nor can it account for another device whose provider preflight
        // finishes first. Revalidate both constraints while this exact action
        // and its owner are locked, immediately before provider use. Direct
        // actions use the same account safety policy even without a sequence.
        let replacementScheduledAt =
          !isWithinSendingWindow(providerStartAt, settings) ||
          scheduledUtcDay !== startUtcDay
            ? await this.sequenceLinkedinThrottleService.reserveSlot({
                workspaceId,
                ownerWorkspaceMemberId: workspaceMemberId,
                settings,
                now: providerStartAt,
                transactionManager,
                excludedActionId: action.id,
              })
            : await this.sequenceLinkedinThrottleService.reserveClaimSlotIfDailyCapExceeded(
                {
                  workspaceId,
                  ownerWorkspaceMemberId: workspaceMemberId,
                  settings,
                  now: providerStartAt,
                  transactionManager,
                  actionId: action.id,
                  actionScheduledAt: action.scheduledAt,
                },
              );

        if (
          scheduledUtcDay === startUtcDay &&
          !isDefined(replacementScheduledAt)
        ) {
          replacementScheduledAt =
            await this.sequenceLinkedinThrottleService.reserveClaimSlotIfTooEarly(
              {
                workspaceId,
                ownerWorkspaceMemberId: workspaceMemberId,
                settings,
                now: providerStartAt,
                transactionManager,
                actionId: action.id,
                actionScheduledAt: action.scheduledAt,
              },
            );
        }

        if (isDefined(replacementScheduledAt)) {
          const releaseResult = await actionRepository.update(
            {
              id: action.id,
              ownerWorkspaceMemberId: workspaceMemberId,
              sequenceEnrollmentId: isDefined(sequenceEnrollmentId)
                ? sequenceEnrollmentId
                : IsNull(),
              sequenceStepId: isDefined(sequenceStepId)
                ? sequenceStepId
                : IsNull(),
              status: LINKEDIN_ACTION_STATUSES.CLAIMED,
              claimedAt,
              claimedBy,
            },
            {
              status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
              scheduledAt: replacementScheduledAt,
              claimedAt: null,
              claimedBy: null,
              executedAt: null,
            },
            transactionManager,
          );

          if (releaseResult.affected !== 1) {
            return null;
          }

          return this.toResult({
            ...action,
            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
            scheduledAt: replacementScheduledAt,
            claimedAt: null,
            claimedBy: null,
            executedAt: null,
          });
        }

        // claimedAt is the stable compare-and-set identity used by the final
        // report. executedAt is the renewable provider-start lease: retaining
        // the claim token makes a committed start idempotently retryable when
        // its HTTP response is lost, while the scheduler still sees a fresh
        // lease immediately before every actual outbound attempt.
        const updateResult = await actionRepository.update(
          {
            id: action.id,
            ownerWorkspaceMemberId: workspaceMemberId,
            sequenceEnrollmentId: isDefined(sequenceEnrollmentId)
              ? sequenceEnrollmentId
              : IsNull(),
            sequenceStepId: isDefined(sequenceStepId)
              ? sequenceStepId
              : IsNull(),
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt,
            claimedBy,
          },
          { executedAt: providerStartAt },
          transactionManager,
        );

        if (updateResult.affected !== 1) {
          return null;
        }

        return this.toResult({ ...action, executedAt: providerStartAt });
      },
    });
  }

  private async reconcileRepliesBeforeStart({
    actionId,
    claimedAt,
    claimedBy,
    workspaceId,
    workspaceMemberId,
  }: {
    actionId: string;
    claimedAt: Date;
    claimedBy: string;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<boolean> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const actionRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            LinkedinActionWorkspaceEntity,
          );
        const enrollmentRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceEnrollmentWorkspaceEntity,
          );
        const actionCandidate = await actionRepository.findOne({
          where: {
            id: actionId,
            ownerWorkspaceMemberId: workspaceMemberId,
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt,
            claimedBy,
          },
          select: ['id', 'sequenceEnrollmentId'],
        });

        if (!isDefined(actionCandidate?.sequenceEnrollmentId)) {
          return false;
        }

        const enrollment = await enrollmentRepository.findOne({
          where: { id: actionCandidate.sequenceEnrollmentId },
          select: ['id', 'personId', 'sentEmailsByStepId'],
        });

        if (!isDefined(enrollment)) {
          return false;
        }

        const didReconcileEmailReply =
          await this.sequenceEmailReplyReconciliationService.reconcileBeforeEnrollmentProgress(
            {
              workspaceId,
              enrollment,
              enrollmentRepository,
            },
          );

        if (didReconcileEmailReply) {
          return true;
        }

        return this.sequenceLinkedinReplyListener.reconcileEnrollmentBeforeProviderStart(
          {
            sequenceEnrollmentId: enrollment.id,
            workspaceId,
          },
        );
      },
    );
  }

  async report({
    actionId,
    claimedAt,
    claimedBy,
    data,
    now = new Date(),
    workspaceId,
    workspaceMemberId,
  }: {
    actionId: string;
    claimedAt: Date;
    claimedBy: string;
    data: SequenceLinkedinActionReportInput;
    now?: Date;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    this.validateReport(data);

    return this.withLockedClaim({
      actionId,
      claimedAt,
      claimedBy,
      workspaceId,
      workspaceMemberId,
      operation: async ({
        action,
        actionRepository,
        enrollment,
        enrollmentRepository,
        sequence,
        sequenceEnrollmentId,
        sequenceStepId,
        transactionManager,
      }) => {
        const providerWasStarted = isDefined(action.executedAt);

        // Only start() can establish that a provider operation began. Any
        // non-skip terminal report before that boundary is safely retried (or
        // cancelled/failed under the locked lifecycle state) rather than
        // trusting a browser-supplied timestamp or outcome.
        if (
          !providerWasStarted &&
          data.status !== LINKEDIN_ACTION_STATUSES.SKIPPED
        ) {
          return this.handleUnstartedReport({
            action,
            actionRepository,
            claimedAt,
            claimedBy,
            enrollment,
            enrollmentRepository,
            now,
            sequence,
            sequenceEnrollmentId,
            sequenceStepId,
            transactionManager,
            workspaceId,
            workspaceMemberId,
          });
        }

        // A pre-start skip describes authoritative DOM state (already
        // connected, pending, or withdrawn), not provider activity. It still
        // advances the enrollment but must not consume the daily quota.
        const executedAt = providerWasStarted ? action.executedAt : null;
        const errorMessage = data.errorMessage ?? null;
        const updateResult = await actionRepository.update(
          {
            id: action.id,
            ownerWorkspaceMemberId: workspaceMemberId,
            sequenceEnrollmentId: isDefined(sequenceEnrollmentId)
              ? sequenceEnrollmentId
              : IsNull(),
            sequenceStepId: isDefined(sequenceStepId)
              ? sequenceStepId
              : IsNull(),
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt,
            claimedBy,
          },
          {
            status: data.status,
            connectionState: data.connectionState,
            errorMessage,
            executedAt,
          },
          transactionManager,
        );

        if (updateResult.affected !== 1) {
          return null;
        }

        return this.toResult({
          ...action,
          status: data.status,
          connectionState: data.connectionState,
          errorMessage,
          executedAt,
        });
      },
    });
  }

  async release({
    actionId,
    claimedAt,
    claimedBy,
    workspaceId,
    workspaceMemberId,
  }: {
    actionId: string;
    claimedAt: Date;
    claimedBy: string;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    return this.withLockedClaim({
      actionId,
      claimedAt,
      claimedBy,
      workspaceId,
      workspaceMemberId,
      operation: async ({
        action,
        actionRepository,
        enrollment,
        enrollmentRepository,
        sequence,
        sequenceEnrollmentId,
        sequenceStepId,
        transactionManager,
      }) => {
        const isUnlinkedAction = !isDefined(sequenceEnrollmentId);
        const enrollmentStillWaitsForAction =
          !isUnlinkedAction &&
          isDefined(enrollment) &&
          !isDefined(enrollment.deletedAt) &&
          enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE &&
          enrollment.waitingOn === SEQUENCE_WAITING_ON.LINKEDIN_ACTION &&
          enrollment.currentStepId === sequenceStepId;
        const canReschedule =
          isUnlinkedAction ||
          (isDefined(sequence) &&
            !isDefined(sequence.deletedAt) &&
            sequence.status === SEQUENCE_STATUSES.ACTIVE &&
            enrollmentStillWaitsForAction);

        // release() is a pre-provider operation. Once start() committed, only a
        // real report or stale-claim reconciliation may decide the outcome.
        if (isDefined(action.executedAt)) {
          return null;
        }

        const releasedStatus = canReschedule
          ? LINKEDIN_ACTION_STATUSES.SCHEDULED
          : LINKEDIN_ACTION_STATUSES.CANCELLED;
        const cancellationErrorMessage =
          !isUnlinkedAction &&
          enrollmentStillWaitsForAction &&
          isDefined(sequence) &&
          (sequence.status !== SEQUENCE_STATUSES.ACTIVE ||
            isDefined(sequence.deletedAt))
            ? SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR
            : SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR;

        const updateResult = await actionRepository.update(
          {
            id: action.id,
            ownerWorkspaceMemberId: workspaceMemberId,
            sequenceEnrollmentId: isDefined(sequenceEnrollmentId)
              ? sequenceEnrollmentId
              : IsNull(),
            sequenceStepId: isDefined(sequenceStepId)
              ? sequenceStepId
              : IsNull(),
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            claimedAt,
            claimedBy,
          },
          {
            status: releasedStatus,
            claimedAt: null,
            claimedBy: null,
            executedAt: null,
            ...(!canReschedule
              ? { errorMessage: cancellationErrorMessage }
              : {}),
          },
          transactionManager,
        );

        if (updateResult.affected !== 1) {
          return null;
        }

        if (
          !canReschedule &&
          enrollmentStillWaitsForAction &&
          cancellationErrorMessage === SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR &&
          isDefined(enrollment)
        ) {
          const enrollmentUpdateResult = await enrollmentRepository.update(
            {
              id: enrollment.id,
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
              waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
              currentStepId: isDefined(sequenceStepId)
                ? sequenceStepId
                : IsNull(),
            },
            {
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              nextActionAt: new Date(),
            },
            transactionManager,
          );

          if (enrollmentUpdateResult.affected !== 1) {
            throw new Error(
              `Could not quiesce enrollment ${enrollment.id} after releasing LinkedIn action ${action.id}`,
            );
          }
        }

        return this.toResult({
          ...action,
          status: releasedStatus,
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
          ...(!canReschedule ? { errorMessage: cancellationErrorMessage } : {}),
        });
      },
    });
  }

  private async handleUnstartedReport({
    action,
    actionRepository,
    claimedAt,
    claimedBy,
    enrollment,
    enrollmentRepository,
    now,
    sequence,
    sequenceEnrollmentId,
    sequenceStepId,
    transactionManager,
    workspaceId,
    workspaceMemberId,
  }: LockedClaimContext & {
    claimedAt: Date;
    claimedBy: string;
    now: Date;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    const isUnlinkedAction = !isDefined(sequenceEnrollmentId);
    const enrollmentStillWaitsForAction =
      !isUnlinkedAction &&
      isDefined(enrollment) &&
      !isDefined(enrollment.deletedAt) &&
      enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE &&
      enrollment.waitingOn === SEQUENCE_WAITING_ON.LINKEDIN_ACTION &&
      enrollment.currentStepId === sequenceStepId;
    const linkedActionCanRetry =
      !isUnlinkedAction &&
      isDefined(sequence) &&
      !isDefined(sequence.deletedAt) &&
      sequence.status === SEQUENCE_STATUSES.ACTIVE &&
      enrollmentStillWaitsForAction;
    const canRetry = isUnlinkedAction || linkedActionCanRetry;
    const claimWhere = {
      id: action.id,
      ownerWorkspaceMemberId: workspaceMemberId,
      sequenceEnrollmentId: isDefined(sequenceEnrollmentId)
        ? sequenceEnrollmentId
        : IsNull(),
      sequenceStepId: isDefined(sequenceStepId) ? sequenceStepId : IsNull(),
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      claimedAt,
      claimedBy,
    };

    if (!canRetry) {
      const cancellationErrorMessage =
        enrollmentStillWaitsForAction && isDefined(sequence)
          ? SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR
          : SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR;
      const updateResult = await actionRepository.update(
        claimWhere,
        {
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: cancellationErrorMessage,
          executedAt: null,
        },
        transactionManager,
      );

      if (updateResult.affected !== 1) {
        return null;
      }

      if (
        cancellationErrorMessage === SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR &&
        isDefined(enrollment)
      ) {
        const enrollmentUpdateResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            ...(isDefined(sequenceStepId)
              ? { currentStepId: sequenceStepId }
              : {}),
          },
          {
            waitingOn: SEQUENCE_WAITING_ON.DELAY,
            nextActionAt: now,
          },
          transactionManager,
        );

        if (enrollmentUpdateResult.affected !== 1) {
          throw new Error(
            `Could not quiesce enrollment ${enrollment.id} after cancelling LinkedIn action ${action.id}`,
          );
        }
      }

      return this.toResult({
        ...action,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        claimedAt: null,
        claimedBy: null,
        connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
        errorMessage: cancellationErrorMessage,
        executedAt: null,
      });
    }

    if (action.attemptCount >= SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT) {
      const updateResult = await actionRepository.update(
        claimWhere,
        {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
          executedAt: null,
        },
        transactionManager,
      );

      if (updateResult.affected !== 1) {
        return null;
      }

      if (!isUnlinkedAction && isDefined(enrollment)) {
        const enrollmentUpdateResult = await enrollmentRepository.update(
          {
            id: enrollment.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            ...(isDefined(sequenceStepId)
              ? { currentStepId: sequenceStepId }
              : {}),
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: now,
            errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
          },
          transactionManager,
        );

        if (enrollmentUpdateResult.affected !== 1) {
          throw new Error(
            `Could not fail enrollment ${enrollment.id} after exhausting LinkedIn action ${action.id}`,
          );
        }
      }

      return this.toResult({
        ...action,
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
        errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
        executedAt: null,
      });
    }

    const minimumScheduledAt = new Date(
      now.getTime() +
        SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_BASE_MILLISECONDS *
          2 ** action.attemptCount,
    );
    const scheduledAt = await this.sequenceLinkedinThrottleService.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: isDefined(sequence)
        ? parseSequenceSettings(sequence.settings)
        : DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
      now,
      transactionManager,
      excludedActionId: action.id,
      minimumScheduledAt,
    });
    const updateResult = await actionRepository.update(
      claimWhere,
      {
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
        attemptCount: action.attemptCount + 1,
        connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
        errorMessage: null,
      },
      transactionManager,
    );

    if (updateResult.affected !== 1) {
      return null;
    }

    return this.toResult({
      ...action,
      status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      scheduledAt,
      claimedAt: null,
      claimedBy: null,
      executedAt: null,
      attemptCount: action.attemptCount + 1,
      connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
      errorMessage: null,
    });
  }

  private async withLockedClaim<TResult>({
    actionId,
    claimedAt,
    claimedBy,
    operation,
    workspaceId,
    workspaceMemberId,
  }: {
    actionId: string;
    claimedAt: Date;
    claimedBy: string;
    operation: (context: LockedClaimContext) => Promise<TResult | null>;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<TResult | null> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
        const actionRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            LinkedinActionWorkspaceEntity,
          );
        const enrollmentRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceEnrollmentWorkspaceEntity,
          );
        const sequenceRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceWorkspaceEntity,
          );
        const actionCandidate = await actionRepository.findOne({
          where: {
            id: actionId,
            ownerWorkspaceMemberId: workspaceMemberId,
          },
          select: ['id', 'sequenceEnrollmentId', 'sequenceStepId'],
        });

        if (!isDefined(actionCandidate)) {
          return null;
        }

        const sequenceEnrollmentId = actionCandidate.sequenceEnrollmentId;
        const sequenceStepId = actionCandidate.sequenceStepId;

        if (isDefined(sequenceEnrollmentId) !== isDefined(sequenceStepId)) {
          return null;
        }

        if (!isDefined(sequenceEnrollmentId) || !isDefined(sequenceStepId)) {
          return workspaceDataSource.transaction(async (transactionManager) => {
            const workspaceTransactionManager =
              transactionManager as WorkspaceEntityManager;
            const action = await actionRepository.findOne(
              {
                where: {
                  id: actionCandidate.id,
                  ownerWorkspaceMemberId: workspaceMemberId,
                  sequenceEnrollmentId: IsNull(),
                  sequenceStepId: IsNull(),
                  status: LINKEDIN_ACTION_STATUSES.CLAIMED,
                  claimedAt,
                  claimedBy,
                },
                lock: { mode: 'pessimistic_write' },
              },
              workspaceTransactionManager,
            );

            if (!isDefined(action)) {
              return null;
            }

            return operation({
              action,
              actionRepository,
              enrollment: null,
              enrollmentRepository,
              sequence: null,
              sequenceEnrollmentId: null,
              sequenceStepId: null,
              transactionManager: workspaceTransactionManager,
            });
          });
        }

        const enrollmentCandidate = await enrollmentRepository.findOne({
          where: { id: sequenceEnrollmentId },
          select: ['id', 'sequenceId'],
          withDeleted: true,
        });

        if (!isDefined(enrollmentCandidate)) {
          return null;
        }

        return workspaceDataSource.transaction(async (transactionManager) => {
          const workspaceTransactionManager =
            transactionManager as WorkspaceEntityManager;
          const sequence = await sequenceRepository.findOne(
            {
              where: { id: enrollmentCandidate.sequenceId },
              select: ['id', 'status', 'settings', 'deletedAt'],
              withDeleted: true,
              lock: { mode: 'pessimistic_write' },
            },
            workspaceTransactionManager,
          );

          if (!isDefined(sequence)) {
            return null;
          }

          const enrollment = await enrollmentRepository.findOne(
            {
              where: {
                id: enrollmentCandidate.id,
                sequenceId: sequence.id,
              },
              select: [
                'id',
                'currentStepId',
                'status',
                'waitingOn',
                'deletedAt',
              ],
              withDeleted: true,
              lock: { mode: 'pessimistic_write' },
            },
            workspaceTransactionManager,
          );

          if (!isDefined(enrollment)) {
            return null;
          }

          const action = await actionRepository.findOne(
            {
              where: {
                id: actionCandidate.id,
                ownerWorkspaceMemberId: workspaceMemberId,
                sequenceEnrollmentId: enrollment.id,
                sequenceStepId,
                status: LINKEDIN_ACTION_STATUSES.CLAIMED,
                claimedAt,
                claimedBy,
              },
              lock: { mode: 'pessimistic_write' },
            },
            workspaceTransactionManager,
          );

          if (!isDefined(action)) {
            return null;
          }

          return operation({
            action,
            actionRepository,
            enrollment,
            enrollmentRepository,
            sequence,
            sequenceEnrollmentId,
            sequenceStepId,
            transactionManager: workspaceTransactionManager,
          });
        });
      },
    );
  }

  private validateReport(data: SequenceLinkedinActionReportInput): void {
    if (
      !REPORTABLE_LINKEDIN_ACTION_STATUSES.has(data.status) ||
      !LINKEDIN_CONNECTION_STATE_VALUES.has(data.connectionState)
    ) {
      throw new CommonQueryRunnerException(
        'Invalid sequence LinkedIn action report',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`This LinkedIn action report is invalid.`,
        },
      );
    }
  }

  private toResult(
    action: LinkedinActionWorkspaceEntity,
  ): SequenceLinkedinActionMutationResultDTO {
    return {
      id: action.id,
      type: action.type,
      status: action.status,
      scheduledAt: action.scheduledAt,
      claimedAt: action.claimedAt,
      claimedBy: action.claimedBy,
      executedAt: action.executedAt,
      linkedinUrl: action.linkedinUrl,
      noteText: action.noteText,
      connectionState: action.connectionState,
      errorMessage: action.errorMessage,
    };
  }
}
