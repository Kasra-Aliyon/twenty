import { Injectable } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Between, ILike, In, MoreThanOrEqual } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinInvitationWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-invitation.workspace-entity';
import { normalizeLinkedinHandle } from 'src/modules/linkedin/utils/linkedin-identity-matching.util';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  LINKEDIN_ACTION_MAX_AGE_MS,
  SEQUENCE_LINKEDIN_INVITATION_CONFIRMATION_WINDOW_MS,
  SEQUENCE_SCHEDULER_BATCH_SIZE,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

export const LINKEDIN_STALE_CONNECT_CONFIRMATION_ERRORS = [
  'LinkedIn closed the invitation dialog but still offers Connect',
  'LinkedIn closed the invitation dialog but the profile menu still offers Connect',
] as const;

type ReconciliationCandidate = {
  action: LinkedinActionWorkspaceEntity;
  enrollmentId: string;
  executedAt: Date;
  handle: string;
  ownerWorkspaceMemberId: string;
};

@Injectable()
export class SequenceLinkedinInvitationReconcilerService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
  ) {}

  async reconcile({
    workspaceId,
    now,
  }: {
    workspaceId: string;
    now: Date;
  }): Promise<void> {
    const recoveredEnrollmentIds =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const actionRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              LinkedinActionWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const failedActions = await actionRepository.find({
            where: {
              type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
              status: LINKEDIN_ACTION_STATUSES.FAILED,
              errorMessage: In([...LINKEDIN_STALE_CONNECT_CONFIRMATION_ERRORS]),
              executedAt: MoreThanOrEqual(
                new Date(now.getTime() - LINKEDIN_ACTION_MAX_AGE_MS),
              ),
            },
            order: { executedAt: 'ASC' },
            take: SEQUENCE_SCHEDULER_BATCH_SIZE,
          });

          if (failedActions.length === 0) {
            return [];
          }

          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              PersonWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const people = await personRepository.find({
            where: { id: In(failedActions.map(({ personId }) => personId)) },
          });
          const peopleById = new Map(
            people.map((person) => [person.id, person]),
          );
          const candidates = failedActions.flatMap(
            (action): ReconciliationCandidate[] => {
              const handle = normalizeLinkedinHandle(
                peopleById.get(action.personId)?.linkedinLink?.primaryLinkUrl,
              );

              if (
                !isDefined(handle) ||
                !isDefined(action.ownerWorkspaceMemberId) ||
                !isDefined(action.executedAt) ||
                !isDefined(action.sequenceEnrollmentId)
              ) {
                return [];
              }

              return [
                {
                  action,
                  enrollmentId: action.sequenceEnrollmentId,
                  executedAt: action.executedAt,
                  handle,
                  ownerWorkspaceMemberId: action.ownerWorkspaceMemberId,
                },
              ];
            },
          );

          if (candidates.length === 0) {
            return [];
          }

          const invitationRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              LinkedinInvitationWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const invitations = await invitationRepository.find({
            where: candidates.map(
              ({ executedAt, handle, ownerWorkspaceMemberId }) => ({
                direction: 'SENT' as const,
                ownerWorkspaceMemberId,
                handle: ILike(handle),
                sentAt: Between(
                  new Date(
                    executedAt.getTime() -
                      SEQUENCE_LINKEDIN_INVITATION_CONFIRMATION_WINDOW_MS,
                  ),
                  new Date(
                    executedAt.getTime() +
                      SEQUENCE_LINKEDIN_INVITATION_CONFIRMATION_WINDOW_MS,
                  ),
                ),
              }),
            ),
          });
          const invitationKeys = new Set(
            invitations.flatMap((invitation) => {
              const handle = normalizeLinkedinHandle(invitation.handle);

              return isDefined(handle) &&
                isDefined(invitation.ownerWorkspaceMemberId)
                ? [`${invitation.ownerWorkspaceMemberId}:${handle}`]
                : [];
            }),
          );
          const confirmedCandidates = candidates.filter(
            ({ handle, ownerWorkspaceMemberId }) =>
              invitationKeys.has(`${ownerWorkspaceMemberId}:${handle}`),
          );

          if (confirmedCandidates.length === 0) {
            return [];
          }

          const enrollmentRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              SequenceEnrollmentWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const workspaceDataSource =
            await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

          return workspaceDataSource.transaction(async (transactionManager) => {
            const workspaceTransactionManager =
              transactionManager as WorkspaceEntityManager;
            const enrollmentIds: string[] = [];

            for (const { action, enrollmentId } of confirmedCandidates) {
              const actionUpdateResult = await actionRepository.update(
                {
                  id: action.id,
                  status: LINKEDIN_ACTION_STATUSES.FAILED,
                  errorMessage: In([
                    ...LINKEDIN_STALE_CONNECT_CONFIRMATION_ERRORS,
                  ]),
                },
                {
                  status: LINKEDIN_ACTION_STATUSES.COMPLETED,
                  connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
                  errorMessage: null,
                },
                workspaceTransactionManager,
              );

              if (actionUpdateResult.affected !== 1) {
                continue;
              }

              await personRepository.update(
                { id: action.personId },
                {
                  linkedinConnectionState: LINKEDIN_CONNECTION_STATES.PENDING,
                },
                workspaceTransactionManager,
              );

              const enrollmentUpdateResult = await enrollmentRepository.update(
                {
                  id: enrollmentId,
                  status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
                  errorMessage: In([
                    ...LINKEDIN_STALE_CONNECT_CONFIRMATION_ERRORS,
                  ]),
                },
                {
                  status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                  waitingOn: SEQUENCE_WAITING_ON.DELAY,
                  nextActionAt: now,
                  endedAt: null,
                  errorMessage: null,
                },
                workspaceTransactionManager,
              );

              if (enrollmentUpdateResult.affected === 1) {
                enrollmentIds.push(enrollmentId);
              }
            }

            return enrollmentIds;
          });
        },
        buildSystemAuthContext(workspaceId),
      );

    for (const enrollmentId of recoveredEnrollmentIds) {
      await this.sequenceQueueService.enqueueProcess({
        workspaceId,
        enrollmentId,
      });
    }
  }
}
