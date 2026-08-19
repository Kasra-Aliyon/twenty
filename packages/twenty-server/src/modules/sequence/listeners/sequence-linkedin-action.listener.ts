import { Injectable } from '@nestjs/common';

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  type LinkedInActionStatus,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  SEQUENCE_ERROR_MESSAGE_MAX_LENGTH,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

const TERMINAL_LINKEDIN_ACTION_STATUSES = new Set<LinkedInActionStatus>([
  LINKEDIN_ACTION_STATUSES.COMPLETED,
  LINKEDIN_ACTION_STATUSES.SKIPPED,
  LINKEDIN_ACTION_STATUSES.FAILED,
  LINKEDIN_ACTION_STATUSES.CANCELLED,
]);

const NON_FAILURE_LINKEDIN_ACTION_CANCELLATION_ERRORS = new Set([
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
]);

const isNonFailureLinkedinActionCancellation = (
  action: LinkedinActionWorkspaceEntity,
): boolean =>
  action.status === LINKEDIN_ACTION_STATUSES.CANCELLED &&
  isDefined(action.errorMessage) &&
  NON_FAILURE_LINKEDIN_ACTION_CANCELLATION_ERRORS.has(action.errorMessage);

const PENDING_COMPATIBLE_CONNECTION_STATES = [
  LINKEDIN_CONNECTION_STATES.UNKNOWN,
  LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
  LINKEDIN_CONNECTION_STATES.PENDING,
] as const;

@Injectable()
export class SequenceLinkedinActionListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
    private readonly sequenceLinkedinReplyListener: SequenceLinkedinReplyListener,
  ) {}

  @OnDatabaseBatchEvent('linkedinAction', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>
    >,
  ): Promise<void> {
    const eventTerminalActions = payload.events
      .filter(
        (event) =>
          objectRecordChangedProperties(
            event.properties.before,
            event.properties.after,
          ).includes('status') &&
          TERMINAL_LINKEDIN_ACTION_STATUSES.has(
            event.properties.after.status,
          ) &&
          !isNonFailureLinkedinActionCancellation(event.properties.after) &&
          isDefined(event.properties.after.sequenceEnrollmentId),
      )
      .map((event) => event.properties.after);

    if (eventTerminalActions.length === 0) {
      return;
    }

    // Workspace events are emitted before the mutation transaction commits.
    // Locking and rereading the source rows makes this listener wait for that
    // transaction and ignore events whose source update ultimately rolled back.
    const completedActions =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const workspaceDataSource =
            await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
          const actionRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              payload.workspaceId,
              LinkedinActionWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );

          return workspaceDataSource.transaction(async (transactionManager) => {
            const committedActions = await actionRepository.find(
              {
                where: {
                  id: In([
                    ...new Set(eventTerminalActions.map(({ id }) => id)),
                  ]),
                },
                withDeleted: true,
                lock: { mode: 'pessimistic_write' },
              },
              transactionManager as WorkspaceEntityManager,
            );

            return committedActions.filter(
              (action) =>
                TERMINAL_LINKEDIN_ACTION_STATUSES.has(action.status) &&
                !isNonFailureLinkedinActionCancellation(action) &&
                isDefined(action.sequenceEnrollmentId),
            );
          });
        },
        buildSystemAuthContext(payload.workspaceId),
      );

    if (completedActions.length === 0) {
      return;
    }

    const completedOutboundActions = completedActions.filter(
      (action) =>
        action.status === LINKEDIN_ACTION_STATUSES.COMPLETED &&
        (action.type === LINKEDIN_ACTION_TYPES.SEND_MESSAGE ||
          action.type === LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST),
    );

    if (completedOutboundActions.length > 0) {
      await this.sequenceLinkedinReplyListener.reconcileCompletedOutboundActions(
        {
          actions: completedOutboundActions,
          workspaceId: payload.workspaceId,
        },
      );
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          payload.workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          payload.workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      for (const action of completedActions) {
        if (!isDefined(action.sequenceEnrollmentId)) {
          continue;
        }

        if (
          isDefined(action.personId) &&
          action.connectionState !== LINKEDIN_CONNECTION_STATES.UNKNOWN
        ) {
          await personRepository.update(
            action.connectionState === LINKEDIN_CONNECTION_STATES.PENDING
              ? {
                  id: action.personId,
                  linkedinConnectionState: In([
                    ...PENDING_COMPATIBLE_CONNECTION_STATES,
                  ]),
                }
              : { id: action.personId },
            { linkedinConnectionState: action.connectionState },
          );
        }

        if (
          action.status === LINKEDIN_ACTION_STATUSES.COMPLETED ||
          action.status === LINKEDIN_ACTION_STATUSES.SKIPPED
        ) {
          const updateResult = await enrollmentRepository.update(
            {
              id: action.sequenceEnrollmentId,
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
              waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
              ...(isDefined(action.sequenceStepId)
                ? { currentStepId: action.sequenceStepId }
                : {}),
            },
            {
              waitingOn: SEQUENCE_WAITING_ON.DELAY,
              nextActionAt: new Date(),
            },
          );

          if (updateResult.affected === 1) {
            await this.sequenceQueueService.enqueueProcess({
              workspaceId: payload.workspaceId,
              enrollmentId: action.sequenceEnrollmentId,
            });
          }

          continue;
        }

        const errorMessage =
          action.errorMessage ??
          (action.status === LINKEDIN_ACTION_STATUSES.CANCELLED
            ? 'LinkedIn action was cancelled'
            : SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_EXPIRED);

        await enrollmentRepository.update(
          {
            id: action.sequenceEnrollmentId,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            ...(isDefined(action.sequenceStepId)
              ? { currentStepId: action.sequenceStepId }
              : {}),
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: new Date(),
            errorMessage: errorMessage.slice(
              0,
              SEQUENCE_ERROR_MESSAGE_MAX_LENGTH,
            ),
          },
        );
      }
    }, buildSystemAuthContext(payload.workspaceId));
  }
}
