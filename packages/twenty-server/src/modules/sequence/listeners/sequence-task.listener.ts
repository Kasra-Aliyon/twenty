import { Injectable } from '@nestjs/common';

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { isDefined } from 'twenty-shared/utils';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import { type TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

@Injectable()
export class SequenceTaskListener {
  constructor(
    private readonly sequenceTaskCompletionService: SequenceTaskCompletionService,
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

    for (const task of completedSequenceTasks) {
      if (
        !isDefined(task.sequenceEnrollmentId) ||
        !isDefined(task.sequenceStepId)
      ) {
        continue;
      }

      await this.sequenceTaskCompletionService.completeTaskStep({
        workspaceId: payload.workspaceId,
        enrollmentId: task.sequenceEnrollmentId,
        stepId: task.sequenceStepId,
      });
    }
  }
}
