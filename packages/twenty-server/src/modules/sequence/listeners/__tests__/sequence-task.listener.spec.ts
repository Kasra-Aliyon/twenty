import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { SequenceTaskListener } from 'src/modules/sequence/listeners/sequence-task.listener';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { type TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

describe('SequenceTaskListener', () => {
  it('advances and enqueues an enrollment when its current task becomes done', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getRepository: jest.fn().mockResolvedValue({ update }),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const listener = new SequenceTaskListener(
      globalWorkspaceOrmManager,
      sequenceQueueService,
    );
    const before = {
      id: 'task-id',
      status: 'TODO',
      sequenceEnrollmentId: 'enrollment-id',
      sequenceStepId: 'step-id',
    } as TaskWorkspaceEntity;
    const after = { ...before, status: 'DONE' } as TaskWorkspaceEntity;
    const payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<TaskWorkspaceEntity>
    > = {
      name: 'task',
      workspaceId: 'workspace-id',
      objectMetadata: {} as FlatObjectMetadata,
      events: [
        {
          recordId: 'task-id',
          properties: { before, after },
        } as ObjectRecordUpdateEvent<TaskWorkspaceEntity>,
      ],
    };

    await listener.handleUpdatedEvent(payload);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'enrollment-id',
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        currentStepId: 'step-id',
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      enrollmentId: 'enrollment-id',
    });
  });

  it('ignores task updates that do not become done', async () => {
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(),
    } as unknown as GlobalWorkspaceOrmManager;
    const sequenceQueueService = {
      enqueueProcess: jest.fn(),
    } as unknown as SequenceQueueService;
    const listener = new SequenceTaskListener(
      globalWorkspaceOrmManager,
      sequenceQueueService,
    );

    await listener.handleUpdatedEvent({
      name: 'task',
      workspaceId: 'workspace-id',
      objectMetadata: {} as FlatObjectMetadata,
      events: [
        {
          recordId: 'task-id',
          properties: {
            before: { status: 'TODO' } as TaskWorkspaceEntity,
            after: { status: 'IN_PROGRESS' } as TaskWorkspaceEntity,
          },
        } as ObjectRecordUpdateEvent<TaskWorkspaceEntity>,
      ],
    });

    expect(
      globalWorkspaceOrmManager.executeInWorkspaceContext,
    ).not.toHaveBeenCalled();
  });
});
