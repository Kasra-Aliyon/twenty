import { Injectable } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IsNull, LessThanOrEqual } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type SequenceLinkedinActionClaimDTO } from 'src/modules/sequence/dtos/sequence-linkedin-action-claim.dto';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import {
  SequenceSenderService,
  SequenceSenderUnavailableError,
} from 'src/modules/sequence/services/sequence-sender.service';
import {
  DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_CLAIM_GRACE_MS,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';

@Injectable()
export class SequenceLinkedinActionClaimService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceEmailReplyReconciliationService: SequenceEmailReplyReconciliationService,
    private readonly sequenceLinkedinReplyListener: SequenceLinkedinReplyListener,
    private readonly sequenceLinkedinThrottleService: SequenceLinkedinThrottleService,
    private readonly sequenceSenderService: SequenceSenderService,
  ) {}

  async claim({
    workspaceId,
    workspaceMemberId,
    actionId,
    claimedBy,
    now = new Date(),
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    actionId: string;
    claimedBy: string;
    now?: Date;
  }): Promise<SequenceLinkedinActionClaimDTO | null> {
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
          where: { id: actionId, ownerWorkspaceMemberId: workspaceMemberId },
          select: ['id', 'ownerWorkspaceMemberId', 'sequenceEnrollmentId'],
        });

        if (!isDefined(actionCandidate)) {
          return null;
        }

        const enrollmentCandidate = isDefined(
          actionCandidate.sequenceEnrollmentId,
        )
          ? await enrollmentRepository.findOne({
              where: { id: actionCandidate.sequenceEnrollmentId },
              select: [
                'id',
                'personId',
                'senderConnectedAccountId',
                'sentEmailsByStepId',
                'sequenceId',
              ],
            })
          : null;

        if (isDefined(actionCandidate.sequenceEnrollmentId)) {
          if (!isDefined(enrollmentCandidate)) {
            return null;
          }

          if (
            await this.sequenceEmailReplyReconciliationService.reconcileBeforeEnrollmentProgress(
              {
                workspaceId,
                enrollment: enrollmentCandidate,
                enrollmentRepository,
              },
            )
          ) {
            return null;
          }

          if (
            await this.sequenceLinkedinReplyListener.reconcileEnrollmentBeforeProviderStart(
              {
                sequenceEnrollmentId: enrollmentCandidate.id,
                workspaceId,
              },
            )
          ) {
            return null;
          }

          const sequenceCandidate = isDefined(
            enrollmentCandidate.senderConnectedAccountId,
          )
            ? null
            : await sequenceRepository.findOne({
                where: { id: enrollmentCandidate.sequenceId },
                select: ['id', 'senderConnectedAccountId'],
              });
          const senderConnectedAccountId =
            enrollmentCandidate.senderConnectedAccountId ??
            sequenceCandidate?.senderConnectedAccountId;

          if (!isDefined(senderConnectedAccountId)) {
            await this.failScheduledActionForUnavailableSender({
              actionId,
              actionRepository,
              sequenceEnrollmentId: enrollmentCandidate.id,
              workspaceMemberId,
            });

            return null;
          }

          try {
            return await this.sequenceSenderService.withLockedSenderAccountOrThrow(
              {
                connectedAccountId: senderConnectedAccountId,
                operation: (connectedAccount) =>
                  workspaceDataSource.transaction(
                    async (transactionManager) => {
                      const workspaceTransactionManager =
                        transactionManager as WorkspaceEntityManager;

                      // Core account -> sequence -> enrollment -> action is the
                      // shared claim order. The core lock remains held until
                      // this workspace transaction commits.
                      const activeSequence = await sequenceRepository.findOne(
                        {
                          where: {
                            id: enrollmentCandidate.sequenceId,
                            status: SEQUENCE_STATUSES.ACTIVE,
                          },
                          select: [
                            'id',
                            'senderConnectedAccountId',
                            'settings',
                          ],
                          lock: { mode: 'pessimistic_write' },
                        },
                        workspaceTransactionManager,
                      );

                      if (!isDefined(activeSequence)) {
                        return null;
                      }

                      const activeEnrollment =
                        await enrollmentRepository.findOne(
                          {
                            where: {
                              id: enrollmentCandidate.id,
                              sequenceId: activeSequence.id,
                              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                              waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
                            },
                            select: [
                              'id',
                              'currentStepId',
                              'senderConnectedAccountId',
                            ],
                            lock: { mode: 'pessimistic_write' },
                          },
                          workspaceTransactionManager,
                        );

                      if (
                        !isDefined(activeEnrollment) ||
                        !isDefined(activeEnrollment.currentStepId)
                      ) {
                        return null;
                      }

                      const lockedSenderConnectedAccountId =
                        activeEnrollment.senderConnectedAccountId ??
                        activeSequence.senderConnectedAccountId;

                      // A sender reassignment between the pre-read and locks is
                      // retried on the next poll with the new account. Never
                      // claim while holding a different account's core lock.
                      if (
                        lockedSenderConnectedAccountId !== connectedAccount.id
                      ) {
                        return null;
                      }

                      const lockedAction = await actionRepository.findOne(
                        {
                          where: {
                            id: actionId,
                            ownerWorkspaceMemberId: workspaceMemberId,
                            sequenceEnrollmentId: activeEnrollment.id,
                            sequenceStepId: activeEnrollment.currentStepId,
                            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                            scheduledAt: LessThanOrEqual(now),
                          },
                          lock: { mode: 'pessimistic_write' },
                        },
                        workspaceTransactionManager,
                      );

                      if (!isDefined(lockedAction)) {
                        return null;
                      }

                      const sequenceSettings = parseSequenceSettings(
                        activeSequence.settings,
                      );

                      if (
                        this.requiresFreshReservation({
                          scheduledAt: lockedAction.scheduledAt,
                          now,
                        })
                      ) {
                        const rescheduledAt =
                          await this.sequenceLinkedinThrottleService.reserveSlot(
                            {
                              workspaceId,
                              ownerWorkspaceMemberId: workspaceMemberId,
                              settings: sequenceSettings,
                              now,
                              transactionManager: workspaceTransactionManager,
                              excludedActionId: lockedAction.id,
                            },
                          );

                        await actionRepository.update(
                          {
                            id: lockedAction.id,
                            ownerWorkspaceMemberId: workspaceMemberId,
                            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                            scheduledAt: LessThanOrEqual(now),
                          },
                          { scheduledAt: rescheduledAt },
                          workspaceTransactionManager,
                        );

                        return null;
                      }

                      const dailyCapSlot =
                        await this.sequenceLinkedinThrottleService.reserveClaimSlotIfDailyCapExceeded(
                          {
                            actionId: lockedAction.id,
                            actionScheduledAt: lockedAction.scheduledAt,
                            now,
                            ownerWorkspaceMemberId: workspaceMemberId,
                            settings: sequenceSettings,
                            transactionManager: workspaceTransactionManager,
                            workspaceId,
                          },
                        );

                      if (isDefined(dailyCapSlot)) {
                        await actionRepository.update(
                          {
                            id: lockedAction.id,
                            ownerWorkspaceMemberId: workspaceMemberId,
                            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                            scheduledAt: LessThanOrEqual(now),
                          },
                          { scheduledAt: dailyCapSlot },
                          workspaceTransactionManager,
                        );

                        return null;
                      }

                      const actualPacingSlot =
                        await this.sequenceLinkedinThrottleService.reserveClaimSlotIfTooEarly(
                          {
                            actionId: lockedAction.id,
                            actionScheduledAt: lockedAction.scheduledAt,
                            now,
                            ownerWorkspaceMemberId: workspaceMemberId,
                            settings: sequenceSettings,
                            transactionManager: workspaceTransactionManager,
                            workspaceId,
                          },
                        );

                      if (isDefined(actualPacingSlot)) {
                        await actionRepository.update(
                          {
                            id: lockedAction.id,
                            ownerWorkspaceMemberId: workspaceMemberId,
                            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                            scheduledAt: LessThanOrEqual(now),
                          },
                          { scheduledAt: actualPacingSlot },
                          workspaceTransactionManager,
                        );

                        return null;
                      }

                      return this.claimLockedAction({
                        action: lockedAction,
                        actionRepository,
                        claimedBy,
                        now,
                        workspaceMemberId,
                        transactionManager: workspaceTransactionManager,
                      });
                    },
                  ),
                workspaceId,
              },
            );
          } catch (error) {
            if (!(error instanceof SequenceSenderUnavailableError)) {
              throw error;
            }

            await this.failScheduledActionForUnavailableSender({
              actionId,
              actionRepository,
              sequenceEnrollmentId: enrollmentCandidate.id,
              workspaceMemberId,
            });

            return null;
          }
        }

        return workspaceDataSource.transaction(async (transactionManager) => {
          const workspaceTransactionManager =
            transactionManager as WorkspaceEntityManager;
          const lockedAction = await actionRepository.findOne(
            {
              where: {
                id: actionId,
                ownerWorkspaceMemberId: workspaceMemberId,
                sequenceEnrollmentId: IsNull(),
                sequenceStepId: IsNull(),
                status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                scheduledAt: LessThanOrEqual(now),
              },
              lock: { mode: 'pessimistic_write' },
            },
            workspaceTransactionManager,
          );

          if (!isDefined(lockedAction)) {
            return null;
          }

          const replacementScheduledAt = this.isFromPreviousUtcDay(
            lockedAction.scheduledAt,
            now,
          )
            ? await this.sequenceLinkedinThrottleService.reserveSlot({
                workspaceId,
                ownerWorkspaceMemberId: workspaceMemberId,
                settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
                now,
                transactionManager: workspaceTransactionManager,
                excludedActionId: lockedAction.id,
              })
            : await this.sequenceLinkedinThrottleService.reserveClaimSlotIfDailyCapExceeded(
                {
                  actionId: lockedAction.id,
                  actionScheduledAt: lockedAction.scheduledAt,
                  now,
                  ownerWorkspaceMemberId: workspaceMemberId,
                  settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
                  transactionManager: workspaceTransactionManager,
                  workspaceId,
                },
              );

          if (isDefined(replacementScheduledAt)) {
            await actionRepository.update(
              {
                id: lockedAction.id,
                ownerWorkspaceMemberId: workspaceMemberId,
                sequenceEnrollmentId: IsNull(),
                sequenceStepId: IsNull(),
                status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                scheduledAt: LessThanOrEqual(now),
              },
              {
                scheduledAt: replacementScheduledAt,
              },
              workspaceTransactionManager,
            );

            return null;
          }

          const actualPacingSlot =
            await this.sequenceLinkedinThrottleService.reserveClaimSlotIfTooEarly(
              {
                actionId: lockedAction.id,
                actionScheduledAt: lockedAction.scheduledAt,
                now,
                ownerWorkspaceMemberId: workspaceMemberId,
                settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
                transactionManager: workspaceTransactionManager,
                workspaceId,
              },
            );

          if (isDefined(actualPacingSlot)) {
            await actionRepository.update(
              {
                id: lockedAction.id,
                ownerWorkspaceMemberId: workspaceMemberId,
                sequenceEnrollmentId: IsNull(),
                sequenceStepId: IsNull(),
                status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
                scheduledAt: LessThanOrEqual(now),
              },
              { scheduledAt: actualPacingSlot },
              workspaceTransactionManager,
            );

            return null;
          }

          return this.claimLockedAction({
            action: lockedAction,
            actionRepository,
            claimedBy,
            now,
            workspaceMemberId,
            transactionManager: workspaceTransactionManager,
          });
        });
      },
    );
  }

  private async failScheduledActionForUnavailableSender({
    actionId,
    actionRepository,
    sequenceEnrollmentId,
    workspaceMemberId,
  }: {
    actionId: string;
    actionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    sequenceEnrollmentId: string;
    workspaceMemberId: string;
  }): Promise<void> {
    await actionRepository.update(
      {
        id: actionId,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
      {
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
        errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
      },
    );
  }

  private async claimLockedAction({
    action,
    actionRepository,
    claimedBy,
    now,
    workspaceMemberId,
    transactionManager,
  }: {
    action: LinkedinActionWorkspaceEntity;
    actionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    claimedBy: string;
    now: Date;
    workspaceMemberId: string;
    transactionManager: WorkspaceEntityManager;
  }): Promise<SequenceLinkedinActionClaimDTO | null> {
    const claimResult = await actionRepository.update(
      {
        id: action.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: LessThanOrEqual(now),
      },
      {
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt: now,
        claimedBy,
      },
      transactionManager,
    );

    if (claimResult.affected !== 1) {
      return null;
    }

    return {
      id: action.id,
      type: action.type,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: action.scheduledAt,
      claimedAt: now,
      claimedBy,
      executedAt: null,
      linkedinUrl: action.linkedinUrl,
      noteText: action.noteText,
    };
  }

  private isFromPreviousUtcDay(scheduledAt: Date, now: Date): boolean {
    const scheduledDayStart = Date.UTC(
      scheduledAt.getUTCFullYear(),
      scheduledAt.getUTCMonth(),
      scheduledAt.getUTCDate(),
    );
    const currentDayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return scheduledDayStart < currentDayStart;
  }

  private requiresFreshReservation({
    scheduledAt,
    now,
  }: {
    scheduledAt: Date;
    now: Date;
  }): boolean {
    if (this.isFromPreviousUtcDay(scheduledAt, now)) {
      return true;
    }

    // The persisted scheduledAt already encodes pacing. Grace covers only two
    // extension polling cycles and request jitter, independent of that pace.
    return (
      now.getTime() - scheduledAt.getTime() >
      SEQUENCE_LINKEDIN_ACTION_CLAIM_GRACE_MS
    );
  }
}
