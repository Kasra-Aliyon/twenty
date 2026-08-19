import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
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
    findOne: jest.fn(),
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
    find: jest.fn(),
    update: jest.fn(),
  };
  const sequenceMetricsService = {
    recomputeForSequence: jest.fn(),
  } as unknown as SequenceMetricsService;
  let service: SequenceLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    sequenceRepository.findOne.mockImplementation(async (options) => ({
      id: sequenceId,
      deletedAt: options.withDeleted ? new Date() : null,
    }));
    enrollmentRepository.find.mockResolvedValue([]);
    enrollmentRepository.update.mockResolvedValue({ affected: 1 });
    stepRepository.find.mockResolvedValue([]);
    linkedinActionRepository.find.mockResolvedValue([]);
    linkedinActionRepository.update.mockResolvedValue({ affected: 1 });

    const transactionManager = {};
    const transaction = jest.fn(async (callback) =>
      callback(transactionManager),
    );

    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction,
      }),
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
      expect.anything(),
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
      expect.anything(),
    );
    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceEnrollmentId: expect.anything(),
        status: expect.anything(),
      }),
      { status: 'DONE' },
      expect.anything(),
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      {
        sequenceEnrollmentId: expect.anything(),
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: 'Sequence archived',
      }),
      expect.anything(),
    );
    expect(sequenceMetricsService.recomputeForSequence).toHaveBeenCalledWith({
      workspaceId: authContext.workspace.id,
      sequenceId,
    });
  });

  it('preserves a runner-owned claimed action while archiving', async () => {
    let actionStatus: string = LINKEDIN_ACTION_STATUSES.CLAIMED;

    enrollmentRepository.find.mockResolvedValueOnce([{ id: 'enrollment-id' }]);
    linkedinActionRepository.update.mockImplementationOnce(
      async (criteria, values) => {
        if (criteria.status !== actionStatus) {
          return { affected: 0 };
        }

        actionStatus = values.status;

        return { affected: 1 };
      },
    );

    await service.finalizeArchive({ authContext, sequenceId });

    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(actionStatus).toBe(LINKEDIN_ACTION_STATUSES.CLAIMED);
  });

  it('does not finalize enrollment work when the sequence is not archived', async () => {
    sequenceRepository.findOne.mockResolvedValueOnce({
      id: sequenceId,
      deletedAt: null,
    });

    await service.finalizeArchiveInTransaction({
      authContext,
      sequenceId,
      workspaceEntityManager: {} as never,
    });

    expect(enrollmentRepository.find).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).not.toHaveBeenCalled();
  });

  it('detaches tasks while retaining LinkedIn action provenance before permanent deletion', async () => {
    enrollmentRepository.find.mockResolvedValueOnce([{ id: 'enrollment-id' }]);
    stepRepository.find.mockResolvedValueOnce([{ id: 'step-id' }]);
    linkedinActionRepository.find.mockResolvedValueOnce([
      {
        id: 'scheduled-action-id',
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
    ]);

    await service.preparePermanentDeletion({ authContext, sequenceId });

    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      expect.anything(),
    );
    expect(enrollmentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      expect.anything(),
    );
    expect(linkedinActionRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        lock: { mode: 'pessimistic_write' },
      }),
      expect.anything(),
    );
    expect(sequenceRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      enrollmentRepository.find.mock.invocationCallOrder[0],
    );
    expect(enrollmentRepository.find.mock.invocationCallOrder[0]).toBeLessThan(
      linkedinActionRepository.find.mock.invocationCallOrder[0],
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      {
        id: expect.anything(),
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: 'Sequence permanently deleted',
      }),
      expect.anything(),
    );
    expect(taskRepository.update).toHaveBeenCalledWith(
      { sequenceEnrollmentId: expect.anything() },
      { sequenceEnrollmentId: null },
      expect.anything(),
    );
    expect(taskRepository.update).toHaveBeenCalledWith(
      { sequenceStepId: expect.anything() },
      { sequenceStepId: null },
      expect.anything(),
    );
    expect(linkedinActionRepository.update).not.toHaveBeenCalledWith(
      { sequenceEnrollmentId: expect.anything() },
      { sequenceEnrollmentId: null },
      expect.anything(),
    );
    expect(linkedinActionRepository.update).not.toHaveBeenCalledWith(
      { sequenceStepId: expect.anything() },
      { sequenceStepId: null },
      expect.anything(),
    );
  });

  it('rejects permanent deletion while a runner owns a claimed action', async () => {
    enrollmentRepository.find.mockResolvedValueOnce([{ id: 'enrollment-id' }]);
    stepRepository.find.mockResolvedValueOnce([{ id: 'step-id' }]);
    linkedinActionRepository.find.mockResolvedValueOnce([
      {
        id: 'claimed-action-id',
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      },
    ]);

    await expect(
      service.preparePermanentDeletion({ authContext, sequenceId }),
    ).rejects.toThrow(
      'Wait for in-flight LinkedIn actions to finish before permanently deleting the sequence',
    );

    expect(linkedinActionRepository.update).not.toHaveBeenCalled();
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('rejects permanent deletion while an email send lease is unresolved', async () => {
    enrollmentRepository.find.mockResolvedValueOnce([
      {
        id: 'enrollment-id',
        lastSendAttempt: {
          stepId: 'email-step-id',
          attemptedAt: new Date().toISOString(),
        },
        nextActionAt: new Date('2999-01-01T00:00:00.000Z'),
        sentEmailsByStepId: {},
      },
    ]);

    await expect(
      service.preparePermanentDeletion({ authContext, sequenceId }),
    ).rejects.toThrow(
      'Wait for in-flight sequence emails to finish before permanently deleting the sequence',
    );

    expect(stepRepository.find).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).not.toHaveBeenCalled();
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('still protects an unresolved email send after archive clears its scheduling timestamp', async () => {
    enrollmentRepository.find.mockResolvedValueOnce([
      {
        id: 'enrollment-id',
        lastSendAttempt: {
          stepId: 'email-step-id',
          attemptedAt: new Date().toISOString(),
        },
        nextActionAt: null,
        sentEmailsByStepId: {},
      },
    ]);

    await expect(
      service.preparePermanentDeletion({ authContext, sequenceId }),
    ).rejects.toThrow(
      'Wait for in-flight sequence emails to finish before permanently deleting the sequence',
    );

    expect(stepRepository.find).not.toHaveBeenCalled();
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  describe('quiesceOnPause', () => {
    it('pulls a queued LinkedIn action back before it can be sent', async () => {
      enrollmentRepository.find.mockResolvedValue([{ id: 'enrollment-id' }]);
      linkedinActionRepository.find.mockResolvedValue([
        { id: 'action-id', sequenceEnrollmentId: 'enrollment-id' },
      ]);
      enrollmentRepository.update.mockResolvedValue({ affected: 1 });

      await service.quiesceOnPause({ authContext, sequenceId });

      expect(sequenceRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: sequenceId,
            status: SEQUENCE_STATUSES.PAUSED,
          },
          lock: { mode: 'pessimistic_write' },
        }),
        expect.anything(),
      );
      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'enrollment-id',
          waitingOn: 'LINKEDIN_ACTION',
        }),
        expect.objectContaining({ waitingOn: 'DELAY' }),
        expect.anything(),
      );
      expect(linkedinActionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'action-id',
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        }),
        expect.objectContaining({
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        }),
        expect.anything(),
      );
    });

    it('leaves a claimed action alone because the runner already owns it', async () => {
      enrollmentRepository.find.mockResolvedValue([{ id: 'enrollment-id' }]);
      linkedinActionRepository.find.mockResolvedValue([]);

      await service.quiesceOnPause({ authContext, sequenceId });

      expect(linkedinActionRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          }),
        }),
        expect.anything(),
      );
      expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(linkedinActionRepository.update).not.toHaveBeenCalled();
    });

    it('releases only pre-provider Apollo cohorts while preserving started waits', async () => {
      await service.quiesceOnPause({ authContext, sequenceId });

      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: expect.objectContaining({
            _value: [
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
              SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
            ],
          }),
        }),
        expect.objectContaining({
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: expect.any(Date),
        }),
        expect.anything(),
      );
      expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('rolls back instead of releasing the enrollment when cancellation loses its CAS', async () => {
      enrollmentRepository.find.mockResolvedValue([{ id: 'enrollment-id' }]);
      linkedinActionRepository.find.mockResolvedValue([
        { id: 'action-id', sequenceEnrollmentId: 'enrollment-id' },
      ]);
      linkedinActionRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.quiesceOnPause({ authContext, sequenceId }),
      ).rejects.toThrow('Failed to cancel LinkedIn action action-id');

      expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'enrollment-id',
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('does nothing when the persisted sequence is no longer paused', async () => {
      sequenceRepository.findOne.mockResolvedValue(null);
      enrollmentRepository.find.mockResolvedValue([{ id: 'enrollment-id' }]);

      await service.quiesceOnPause({ authContext, sequenceId });

      expect(enrollmentRepository.find).not.toHaveBeenCalled();
      expect(linkedinActionRepository.find).not.toHaveBeenCalled();
      expect(linkedinActionRepository.update).not.toHaveBeenCalled();
    });
  });
});
