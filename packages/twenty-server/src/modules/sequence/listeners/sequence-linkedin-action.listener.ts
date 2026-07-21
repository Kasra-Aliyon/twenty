import { Injectable } from '@nestjs/common';

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  type LinkedInActionStatus,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  SEQUENCE_ERROR_MESSAGE_MAX_LENGTH,
  SEQUENCE_EXECUTION_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

const TERMINAL_LINKEDIN_ACTION_STATUSES = new Set<LinkedInActionStatus>([
  LINKEDIN_ACTION_STATUSES.COMPLETED,
  LINKEDIN_ACTION_STATUSES.SKIPPED,
  LINKEDIN_ACTION_STATUSES.FAILED,
  LINKEDIN_ACTION_STATUSES.CANCELLED,
]);

@Injectable()
export class SequenceLinkedinActionListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
  ) {}

  @OnDatabaseBatchEvent('linkedinAction', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>
    >,
  ): Promise<void> {
    const completedActions = payload.events
      .filter(
        (event) =>
          objectRecordChangedProperties(
            event.properties.before,
            event.properties.after,
          ).includes('status') &&
          TERMINAL_LINKEDIN_ACTION_STATUSES.has(
            event.properties.after.status,
          ) &&
          isDefined(event.properties.after.sequenceEnrollmentId),
      )
      .map((event) => event.properties.after);

    if (completedActions.length === 0) {
      return;
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
            { id: action.personId },
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
