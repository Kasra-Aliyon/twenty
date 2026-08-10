import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { SEQUENCE_ENROLLMENT_STATUSES } from 'twenty-shared/types';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceEnrollmentListener } from 'src/modules/sequence/listeners/sequence-enrollment.listener';
import { type SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { type SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequenceEnrollmentListener', () => {
  it('recomputes metrics and completes open tasks for a terminal status', async () => {
    const recomputeForSequence = jest.fn();
    const completeOpenTasks = jest.fn();
    const updateLinkedinActions = jest.fn();
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) =>
        entity === LinkedinActionWorkspaceEntity
          ? { update: updateLinkedinActions }
          : {},
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const listener = new SequenceEnrollmentListener(
      globalWorkspaceOrmManager,
      { recomputeForSequence } as unknown as SequenceMetricsService,
      { completeOpenTasks } as unknown as SequenceTaskCreatorService,
    );
    const before = {
      id: 'enrollment-id',
      sequenceId: 'sequence-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    } as SequenceEnrollmentWorkspaceEntity;
    const after = {
      ...before,
      status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
    } as SequenceEnrollmentWorkspaceEntity;
    const payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<SequenceEnrollmentWorkspaceEntity>
    > = {
      name: 'sequenceEnrollment',
      workspaceId: 'workspace-id',
      objectMetadata: {} as FlatObjectMetadata,
      events: [
        {
          recordId: 'enrollment-id',
          properties: { before, after },
        } as ObjectRecordUpdateEvent<SequenceEnrollmentWorkspaceEntity>,
      ],
    };

    await listener.handleUpdatedEvent(payload);

    expect(recomputeForSequence).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      sequenceId: 'sequence-id',
    });
    expect(completeOpenTasks).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      enrollmentId: 'enrollment-id',
    });
    expect(updateLinkedinActions).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceEnrollmentId: 'enrollment-id',
        status: expect.anything(),
      }),
      expect.objectContaining({
        status: 'CANCELLED',
        claimedAt: null,
        claimedBy: null,
        errorMessage: expect.stringContaining('REPLIED'),
      }),
    );
  });

  it('ignores updates that do not change status', async () => {
    const recomputeForSequence = jest.fn();
    const completeOpenTasks = jest.fn();
    const listener = new SequenceEnrollmentListener(
      {
        executeInWorkspaceContext: jest.fn(),
      } as unknown as GlobalWorkspaceOrmManager,
      { recomputeForSequence } as unknown as SequenceMetricsService,
      { completeOpenTasks } as unknown as SequenceTaskCreatorService,
    );
    const enrollment = {
      id: 'enrollment-id',
      sequenceId: 'sequence-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    } as SequenceEnrollmentWorkspaceEntity;

    await listener.handleUpdatedEvent({
      name: 'sequenceEnrollment',
      workspaceId: 'workspace-id',
      objectMetadata: {} as FlatObjectMetadata,
      events: [
        {
          recordId: 'enrollment-id',
          properties: {
            before: { ...enrollment, errorMessage: null },
            after: { ...enrollment, errorMessage: 'unchanged status' },
          },
        } as ObjectRecordUpdateEvent<SequenceEnrollmentWorkspaceEntity>,
      ],
    });

    expect(recomputeForSequence).not.toHaveBeenCalled();
    expect(completeOpenTasks).not.toHaveBeenCalled();
  });
});
