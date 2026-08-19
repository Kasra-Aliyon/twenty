import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  type SequenceEnrollmentStatus,
} from 'twenty-shared/types';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

const TERMINAL_ENROLLMENT_STATUSES: ReadonlySet<SequenceEnrollmentStatus> =
  new Set([
    SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
    SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
    SEQUENCE_ENROLLMENT_STATUSES.FAILED,
    SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
  ]);

@Injectable()
export class SequenceEnrollmentListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceMetricsService: SequenceMetricsService,
    private readonly sequenceTaskCreatorService: SequenceTaskCreatorService,
  ) {}

  @OnDatabaseBatchEvent('sequenceEnrollment', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<SequenceEnrollmentWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.handleStatusChanges({
      workspaceId: payload.workspaceId,
      enrollments: payload.events.map((event) => event.properties.after),
    });
  }

  @OnDatabaseBatchEvent('sequenceEnrollment', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<SequenceEnrollmentWorkspaceEntity>
    >,
  ): Promise<void> {
    const changedEnrollments = payload.events
      .filter((event) =>
        objectRecordChangedProperties(
          event.properties.before,
          event.properties.after,
        ).includes('status'),
      )
      .map((event) => event.properties.after);

    await this.handleStatusChanges({
      workspaceId: payload.workspaceId,
      enrollments: changedEnrollments,
    });
  }

  private async handleStatusChanges({
    workspaceId,
    enrollments,
  }: {
    workspaceId: string;
    enrollments: SequenceEnrollmentWorkspaceEntity[];
  }): Promise<void> {
    const enrollmentIdsBySequenceId = new Map<string, string[]>();

    for (const enrollment of enrollments) {
      const enrollmentIds =
        enrollmentIdsBySequenceId.get(enrollment.sequenceId) ?? [];

      enrollmentIds.push(enrollment.id);
      enrollmentIdsBySequenceId.set(enrollment.sequenceId, enrollmentIds);
    }

    for (const [sequenceId, enrollmentIdsToLock] of enrollmentIdsBySequenceId) {
      await this.sequenceMetricsService.recomputeForSequence({
        workspaceId,
        sequenceId,
        enrollmentIdsToLock,
      });
    }

    for (const enrollment of enrollments) {
      if (!TERMINAL_ENROLLMENT_STATUSES.has(enrollment.status)) {
        continue;
      }

      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const linkedinActionRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              LinkedinActionWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );

          await linkedinActionRepository.update(
            {
              sequenceEnrollmentId: enrollment.id,
              status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
            },
            {
              status: LINKEDIN_ACTION_STATUSES.CANCELLED,
              claimedAt: null,
              claimedBy: null,
              executedAt: new Date(),
              errorMessage: `Sequence enrollment ended with status ${enrollment.status}`,
            },
          );
        },
        buildSystemAuthContext(workspaceId),
      );

      await this.sequenceTaskCreatorService.completeOpenTasks({
        workspaceId,
        enrollmentId: enrollment.id,
      });
    }
  }
}
