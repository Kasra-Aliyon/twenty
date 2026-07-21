import { Injectable } from '@nestjs/common';

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

@Injectable()
export class SequenceTaskListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
  ) {}

  @OnDatabaseBatchEvent('task', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<ObjectRecordUpdateEvent<TaskWorkspaceEntity>>,
  ): Promise<void> {
    const completedSequenceTasks = payload.events
      .filter(
        (event) =>
          objectRecordChangedProperties(
            event.properties.before,
            event.properties.after,
          ).includes('status') &&
          event.properties.after.status === 'DONE' &&
          isDefined(event.properties.after.sequenceEnrollmentId),
      )
      .map((event) => event.properties.after);

    if (completedSequenceTasks.length === 0) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          payload.workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      for (const task of completedSequenceTasks) {
        if (!isDefined(task.sequenceEnrollmentId)) {
          continue;
        }

        const updateResult = await enrollmentRepository.update(
          {
            id: task.sequenceEnrollmentId,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: In([
              SEQUENCE_WAITING_ON.TASK_DONE,
              SEQUENCE_WAITING_ON.TASK_DEADLINE,
            ]),
            ...(isDefined(task.sequenceStepId)
              ? { currentStepId: task.sequenceStepId }
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
            enrollmentId: task.sequenceEnrollmentId,
          });
        }
      }
    }, buildSystemAuthContext(payload.workspaceId));
  }
}
