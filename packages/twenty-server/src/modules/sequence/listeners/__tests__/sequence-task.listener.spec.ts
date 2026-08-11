import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { SequenceTaskListener } from 'src/modules/sequence/listeners/sequence-task.listener';
import { type SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import { type TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

describe('SequenceTaskListener', () => {
  it('completes the matching sequence step when its task becomes done', async () => {
    const completeTaskStep = jest.fn();
    const sequenceTaskCompletionService = {
      completeTaskStep,
    } as unknown as SequenceTaskCompletionService;
    const listener = new SequenceTaskListener(sequenceTaskCompletionService);
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

    expect(completeTaskStep).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      enrollmentId: 'enrollment-id',
      stepId: 'step-id',
    });
  });

  it('ignores task updates that do not become done', async () => {
    const completeTaskStep = jest.fn();
    const sequenceTaskCompletionService = {
      completeTaskStep,
    } as unknown as SequenceTaskCompletionService;
    const listener = new SequenceTaskListener(sequenceTaskCompletionService);

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

    expect(completeTaskStep).not.toHaveBeenCalled();
  });
});
