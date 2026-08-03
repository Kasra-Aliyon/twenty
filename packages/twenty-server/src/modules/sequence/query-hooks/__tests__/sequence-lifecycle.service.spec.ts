import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceLifecycleService } from 'src/modules/sequence/query-hooks/sequence-lifecycle.service';
import { type SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

describe('SequenceLifecycleService', () => {
  const authContext = {
    workspace: { id: 'workspace-id' },
  } as WorkspaceAuthContext;
  const sequenceId = 'sequence-id';
  const sequenceRepository = {
    update: jest.fn(),
  };
  const enrollmentRepository = {
    find: jest.fn(),
    update: jest.fn(),
  };
  const stepRepository = {
    find: jest.fn(),
  };
  const taskRepository = {
    update: jest.fn(),
  };
  const linkedinActionRepository = {
    update: jest.fn(),
  };
  const sequenceMetricsService = {
    recomputeForSequence: jest.fn(),
  } as unknown as SequenceMetricsService;
  let service: SequenceLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    enrollmentRepository.find.mockResolvedValue([]);
    stepRepository.find.mockResolvedValue([]);

    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) => {
        if (entity === SequenceWorkspaceEntity) return sequenceRepository;
        if (entity === SequenceEnrollmentWorkspaceEntity) {
          return enrollmentRepository;
        }
        if (entity === SequenceStepWorkspaceEntity) return stepRepository;
        if (entity === TaskWorkspaceEntity) return taskRepository;
        if (entity === LinkedinActionWorkspaceEntity) {
          return linkedinActionRepository;
        }

        return {};
      }),
    } as unknown as GlobalWorkspaceOrmManager;

    service = new SequenceLifecycleService(
      globalWorkspaceOrmManager,
      sequenceMetricsService,
    );
  });

  it('pauses an active sequence before it is archived', async () => {
    await service.pauseBeforeArchive({ authContext, sequenceId });

    expect(sequenceRepository.update).toHaveBeenCalledWith(
      {
        id: sequenceId,
        status: SEQUENCE_STATUSES.ACTIVE,
      },
      { status: SEQUENCE_STATUSES.PAUSED },
    );
  });

  it('stops open enrollment work and retains history while archiving', async () => {
    enrollmentRepository.find.mockResolvedValueOnce([
      { id: 'enrollment-1' },
      { id: 'enrollment-2' },
    ]);

    await service.finalizeArchive({ authContext, sequenceId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.anything(),
        status: expect.anything(),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
        waitingOn: null,
        nextActionAt: null,
        endedAt: expect.any(Date),
      }),
    );
    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceEnrollmentId: expect.anything(),
        status: expect.anything(),
      }),
      { status: 'DONE' },
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceEnrollmentId: expect.anything(),
        status: expect.anything(),
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: 'Sequence archived',
      }),
    );
    expect(sequenceMetricsService.recomputeForSequence).toHaveBeenCalledWith({
      workspaceId: authContext.workspace.id,
      sequenceId,
    });
  });

  it('detaches surviving tasks and LinkedIn actions before permanent deletion', async () => {
    enrollmentRepository.find.mockResolvedValueOnce([{ id: 'enrollment-id' }]);
    stepRepository.find.mockResolvedValueOnce([{ id: 'step-id' }]);

    await service.preparePermanentDeletion({ authContext, sequenceId });

    expect(taskRepository.update).toHaveBeenCalledWith(
      { sequenceEnrollmentId: expect.anything() },
      { sequenceEnrollmentId: null },
    );
    expect(taskRepository.update).toHaveBeenCalledWith(
      { sequenceStepId: expect.anything() },
      { sequenceStepId: null },
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      { sequenceEnrollmentId: expect.anything() },
      { sequenceEnrollmentId: null },
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      { sequenceStepId: expect.anything() },
      { sequenceStepId: null },
    );
  });
});
