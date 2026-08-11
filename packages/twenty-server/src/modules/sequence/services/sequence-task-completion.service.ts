import { Injectable, Logger } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type LinkedInActionType,
  type LinkedInConnectionState,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import {
  SEQUENCE_ERROR_MESSAGE_MAX_LENGTH,
  SEQUENCE_EXECUTION_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

type ManualLinkedinAction = {
  type: LinkedInActionType;
  connectionState: LinkedInConnectionState;
};

@Injectable()
export class SequenceTaskCompletionService {
  private readonly logger = new Logger(SequenceTaskCompletionService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
    private readonly sequenceSenderService: SequenceSenderService,
  ) {}

  async completeTaskStep({
    workspaceId,
    enrollmentId,
    stepId,
  }: {
    workspaceId: string;
    enrollmentId: string;
    stepId: string;
  }): Promise<void> {
    let didAdvance = false;

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
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
      const enrollment = await enrollmentRepository.findOne({
        where: {
          id: enrollmentId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepId: stepId,
          waitingOn: In([
            SEQUENCE_WAITING_ON.TASK_DONE,
            SEQUENCE_WAITING_ON.TASK_DEADLINE,
          ]),
        },
      });

      if (!isDefined(enrollment)) {
        return;
      }

      const step = await stepRepository.findOne({
        where: { id: stepId, sequenceId: enrollment.sequenceId },
      });

      if (!isDefined(step)) {
        await this.failEnrollment({
          enrollmentRepository,
          enrollmentId,
          stepId,
          errorMessage: SEQUENCE_EXECUTION_ERROR.SEQUENCE_TASK_STEP_MISSING,
        });

        return;
      }

      try {
        const manualLinkedinAction = this.getManualLinkedinAction(step);
        let actionInput:
          | (ManualLinkedinAction & {
              ownerWorkspaceMemberId: string;
              person: PersonWorkspaceEntity;
            })
          | null = null;

        if (isDefined(manualLinkedinAction)) {
          const sequenceRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              SequenceWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const sequence = await sequenceRepository.findOne({
            where: { id: enrollment.sequenceId },
            select: ['senderConnectedAccountId'],
          });
          const senderConnectedAccountId =
            enrollment.senderConnectedAccountId ??
            sequence?.senderConnectedAccountId;

          if (!isDefined(senderConnectedAccountId)) {
            throw new Error(SEQUENCE_EXECUTION_ERROR.MISSING_CONNECTED_ACCOUNT);
          }

          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              PersonWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const [ownerWorkspaceMemberId, person] = await Promise.all([
            this.sequenceSenderService.getSenderOwnerWorkspaceMemberIdOrThrow({
              connectedAccountId: senderConnectedAccountId,
              workspaceId,
            }),
            personRepository.findOne({ where: { id: enrollment.personId } }),
          ]);

          if (!isDefined(person)) {
            throw new Error(SEQUENCE_EXECUTION_ERROR.MISSING_PERSON);
          }

          actionInput = {
            ...manualLinkedinAction,
            ownerWorkspaceMemberId,
            person,
          };
        }

        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        didAdvance = await workspaceDataSource.transaction(
          async (transactionManager) => {
            const workspaceTransactionManager =
              transactionManager as WorkspaceEntityManager;
            const updateResult = await enrollmentRepository.update(
              {
                id: enrollmentId,
                status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                currentStepId: stepId,
                waitingOn: In([
                  SEQUENCE_WAITING_ON.TASK_DONE,
                  SEQUENCE_WAITING_ON.TASK_DEADLINE,
                ]),
              },
              {
                waitingOn: SEQUENCE_WAITING_ON.DELAY,
                nextActionAt: new Date(),
              },
              workspaceTransactionManager,
            );

            if (updateResult.affected !== 1) {
              return false;
            }

            if (isDefined(actionInput)) {
              const linkedinActionRepository =
                await this.globalWorkspaceOrmManager.getRepository(
                  workspaceId,
                  LinkedinActionWorkspaceEntity,
                  { shouldBypassPermissionChecks: true },
                );
              const now = new Date();

              await linkedinActionRepository.insert(
                {
                  type: actionInput.type,
                  status: LINKEDIN_ACTION_STATUSES.COMPLETED,
                  scheduledAt: now,
                  claimedAt: null,
                  claimedBy: null,
                  executedAt: now,
                  attemptCount: 0,
                  errorMessage: null,
                  linkedinUrl:
                    actionInput.person.linkedinLink?.primaryLinkUrl ?? '',
                  noteText: '',
                  connectionState: actionInput.connectionState,
                  ownerWorkspaceMemberId: actionInput.ownerWorkspaceMemberId,
                  personId: enrollment.personId,
                  sequenceEnrollmentId: enrollment.id,
                  sequenceStepId: step.id,
                },
                workspaceTransactionManager,
              );
            }

            return true;
          },
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Failed to complete task step for sequence enrollment ${enrollmentId}: ${errorMessage}`,
        );
        await this.failEnrollment({
          enrollmentRepository,
          enrollmentId,
          stepId,
          errorMessage,
        });
      }
    }, buildSystemAuthContext(workspaceId));

    if (didAdvance) {
      await this.sequenceQueueService.enqueueProcess({
        workspaceId,
        enrollmentId,
      });
    }
  }

  private getManualLinkedinAction(
    step: SequenceStepWorkspaceEntity,
  ): ManualLinkedinAction | null {
    if (
      !('executionMode' in step.settings) ||
      step.settings.executionMode !== SEQUENCE_ACTION_EXECUTION_MODES.MANUAL
    ) {
      return null;
    }

    switch (step.settings.type) {
      case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
        return {
          type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
          connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        };
      case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
        return {
          type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
          connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        };
      case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
        return {
          type: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
          connectionState: LINKEDIN_CONNECTION_STATES.WITHDRAWN,
        };
      default:
        return null;
    }
  }

  private async failEnrollment({
    enrollmentRepository,
    enrollmentId,
    stepId,
    errorMessage,
  }: {
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    enrollmentId: string;
    stepId: string;
    errorMessage: string;
  }): Promise<void> {
    await enrollmentRepository.update(
      {
        id: enrollmentId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepId: stepId,
        waitingOn: In([
          SEQUENCE_WAITING_ON.TASK_DONE,
          SEQUENCE_WAITING_ON.TASK_DEADLINE,
        ]),
      },
      {
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        waitingOn: null,
        nextActionAt: null,
        endedAt: new Date(),
        errorMessage: errorMessage.slice(0, SEQUENCE_ERROR_MESSAGE_MAX_LENGTH),
      },
    );
  }
}
