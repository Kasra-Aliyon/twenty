import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { type SequenceLifecycleService } from 'src/modules/sequence/query-hooks/sequence-lifecycle.service';
import { SequenceMutationSerializationService } from 'src/modules/sequence/query-hooks/sequence-mutation-serialization.service';
import { SequenceUpdateOnePreQueryHook } from 'src/modules/sequence/query-hooks/sequence.query-hooks';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

describe('SequenceMutationSerializationService persistence regressions', () => {
  const authContext = {
    workspace: { id: 'workspace-id' },
  } as WorkspaceAuthContext;
  const workspaceEntityManager = {} as WorkspaceEntityManager;

  const setupEnrollmentSkip = ({
    enrollment,
  }: {
    enrollment: SequenceEnrollmentWorkspaceEntity;
  }) => {
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(enrollment),
    };
    const sequenceRepository = {
      find: jest.fn().mockResolvedValue([{ id: enrollment.sequenceId }]),
    };
    const linkedinActionRepository = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const taskRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
      [TaskWorkspaceEntity, taskRepository],
    ]);
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(async (_workspaceId, entity) =>
        repositories.get(entity),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const normalizedUpdate = {
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
      nextActionAt: new Date('2026-08-20T10:00:00.000Z'),
    };
    const invariantService = {
      normalizeEnrollmentUpdate: jest.fn().mockResolvedValue(normalizedUpdate),
    } as unknown as SequenceInvariantService;

    return {
      service: new SequenceMutationSerializationService(
        globalWorkspaceOrmManager,
        invariantService,
      ),
      linkedinActionRepository,
      normalizedUpdate,
      taskRepository,
    };
  };

  it('rejects Skip when an expired email claim is unresolved without a daily reservation', async () => {
    const stepId = 'email-step-id';
    const enrollment = {
      id: 'enrollment-id',
      sequenceId: 'sequence-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      currentStepId: stepId,
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date('2026-08-19T10:00:00.000Z'),
      sentEmailsByStepId: {},
      lastSendAttempt: {
        stepId,
        attemptedAt: '2026-08-19T09:00:00.000Z',
        previousCursor: {
          currentStepId: null,
          currentStepPosition: -1,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: '2026-08-19T09:00:00.000Z',
          stopOnReply: true,
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, linkedinActionRepository } = setupEnrollmentSkip({
      enrollment,
    });

    await expect(
      service.serializeEnrollmentUpdate({
        authContext,
        data: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date('2026-08-20T10:00:00.000Z'),
        },
        enrollmentId: enrollment.id,
        workspaceEntityManager,
      }),
    ).rejects.toThrow('interrupted sequence email to recover');
    expect(linkedinActionRepository.find).not.toHaveBeenCalled();
  });

  it('marks the current open manual task DONE in the same Skip transaction', async () => {
    const enrollment = {
      id: 'task-enrollment-id',
      sequenceId: 'sequence-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      currentStepId: 'manual-task-step-id',
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      nextActionAt: null,
      sentEmailsByStepId: {},
      lastSendAttempt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, normalizedUpdate, taskRepository } = setupEnrollmentSkip({
      enrollment,
    });

    await expect(
      service.serializeEnrollmentUpdate({
        authContext,
        data: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date('2026-08-20T10:00:00.000Z'),
        },
        enrollmentId: enrollment.id,
        workspaceEntityManager,
      }),
    ).resolves.toEqual(normalizedUpdate);
    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceEnrollmentId: enrollment.id,
        sequenceStepId: enrollment.currentStepId,
        status: expect.anything(),
      }),
      { status: 'DONE' },
      workspaceEntityManager,
    );
  });

  it('atomically swaps a same-branch occupant so the UI follow-up update converges', async () => {
    const sequenceId = 'sequence-id';
    const currentStep = {
      id: 'first-step-id',
      sequenceId,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const otherBranchStep = {
      ...currentStep,
      id: 'other-branch-step-id',
      position: 1,
      settings: {
        ...currentStep.settings,
        branch: { conditionStepId: 'condition-id', outcome: 'YES' },
      },
    } as SequenceStepWorkspaceEntity;
    const occupyingStep = {
      ...currentStep,
      id: 'occupying-step-id',
      position: 1,
    } as SequenceStepWorkspaceEntity;
    const steps = [currentStep, otherBranchStep, occupyingStep];
    const stepRepository = {
      findOne: jest.fn(async (options) =>
        steps.find(({ id }) => id === options.where.id),
      ),
      find: jest.fn(async (options) =>
        steps.filter(
          ({ position, sequenceId: candidateSequenceId }) =>
            candidateSequenceId === options.where.sequenceId &&
            position === options.where.position,
        ),
      ),
      update: jest.fn(async (criteria, values) => {
        const stepToUpdate = steps.find(({ id }) => id === criteria.id);

        if (!stepToUpdate) return { affected: 0 };

        stepToUpdate.position = values.position;

        return { affected: 1 };
      }),
    };
    const sequenceRepository = {
      find: jest.fn().mockResolvedValue([{ id: sequenceId }]),
    };
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(async (_workspaceId, entity) => {
        if (entity === SequenceStepWorkspaceEntity) return stepRepository;
        if (entity === SequenceWorkspaceEntity) return sequenceRepository;

        throw new Error('Unexpected repository');
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const invariantService = {
      assertStepUpdateAllowed: jest.fn(),
    } as unknown as SequenceInvariantService;
    const service = new SequenceMutationSerializationService(
      globalWorkspaceOrmManager,
      invariantService,
    );
    const hook = new SequenceUpdateOnePreQueryHook(
      service,
      {} as SequenceLifecycleService,
    );
    const payload = {
      id: currentStep.id,
      data: { position: 1 },
    } as never;

    await hook.executeInTransaction(
      authContext,
      'sequenceStep',
      payload,
      workspaceEntityManager,
    );

    // The real update query applies immediately after the pre-hook within the
    // same transaction.
    currentStep.position = 1;

    await hook.executeInTransaction(
      authContext,
      'sequenceStep',
      {
        id: occupyingStep.id,
        data: { position: 0 },
      } as never,
      workspaceEntityManager,
    );

    expect(stepRepository.update).toHaveBeenCalledWith(
      {
        id: occupyingStep.id,
        sequenceId,
        position: 1,
      },
      { position: 0 },
      workspaceEntityManager,
    );
    expect(stepRepository.update).toHaveBeenCalledTimes(1);
    expect(currentStep.position).toBe(1);
    expect(occupyingStep.position).toBe(0);
    expect(otherBranchStep.position).toBe(1);
  });

  it('uses the projected branch and rejects an occupied target when branch and position change together', async () => {
    const sequenceId = 'sequence-id';
    const currentStep = {
      id: 'moving-step-id',
      sequenceId,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
        branch: { conditionStepId: 'condition-id', outcome: 'YES' },
      },
    } as SequenceStepWorkspaceEntity;
    const oldBranchOccupant = {
      ...currentStep,
      id: 'old-branch-occupant-id',
      position: 1,
    } as SequenceStepWorkspaceEntity;
    const targetRootOccupant = {
      ...currentStep,
      id: 'target-root-occupant-id',
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const steps = [currentStep, oldBranchOccupant, targetRootOccupant];
    const stepRepository = {
      findOne: jest.fn(async (options) =>
        steps.find(({ id }) => id === options.where.id),
      ),
      find: jest.fn(async (options) =>
        steps.filter(
          ({ position, sequenceId: candidateSequenceId }) =>
            candidateSequenceId === options.where.sequenceId &&
            position === options.where.position,
        ),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const sequenceRepository = {
      find: jest.fn().mockResolvedValue([{ id: sequenceId }]),
    };
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(async (_workspaceId, entity) =>
        entity === SequenceStepWorkspaceEntity
          ? stepRepository
          : sequenceRepository,
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const service = new SequenceMutationSerializationService(
      globalWorkspaceOrmManager,
      {
        assertStepUpdateAllowed: jest.fn(),
      } as unknown as SequenceInvariantService,
    );
    const hook = new SequenceUpdateOnePreQueryHook(
      service,
      {} as SequenceLifecycleService,
    );
    const requestedSettings = {
      type: SEQUENCE_STEP_TYPES.DELAY,
      days: 1,
      hours: 0,
      minutes: 0,
    } as SequenceStepWorkspaceEntity['settings'];

    await expect(
      hook.executeInTransaction(
        authContext,
        'sequenceStep',
        {
          id: currentStep.id,
          data: { position: 1, settings: requestedSettings },
        } as never,
        workspaceEntityManager,
      ),
    ).rejects.toThrow('already has a step at that position');
    expect(stepRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a branch-only move when its unchanged position is occupied in the target branch', async () => {
    const sequenceId = 'sequence-id';
    const currentStep = {
      id: 'moving-step-id',
      sequenceId,
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
        branch: { conditionStepId: 'condition-id', outcome: 'YES' },
      },
    } as SequenceStepWorkspaceEntity;
    const targetRootOccupant = {
      ...currentStep,
      id: 'target-root-occupant-id',
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const stepRepository = {
      findOne: jest.fn().mockResolvedValue(currentStep),
      find: jest.fn().mockResolvedValue([currentStep, targetRootOccupant]),
      update: jest.fn(),
    };
    const sequenceRepository = {
      find: jest.fn().mockResolvedValue([{ id: sequenceId }]),
    };
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(async (_workspaceId, entity) =>
        entity === SequenceStepWorkspaceEntity
          ? stepRepository
          : sequenceRepository,
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const service = new SequenceMutationSerializationService(
      globalWorkspaceOrmManager,
      {
        assertStepUpdateAllowed: jest.fn(),
      } as unknown as SequenceInvariantService,
    );
    const hook = new SequenceUpdateOnePreQueryHook(
      service,
      {} as SequenceLifecycleService,
    );

    await expect(
      hook.executeInTransaction(
        authContext,
        'sequenceStep',
        {
          id: currentStep.id,
          data: {
            settings: {
              type: SEQUENCE_STEP_TYPES.DELAY,
              days: 1,
              hours: 0,
              minutes: 0,
            },
          },
        } as never,
        workspaceEntityManager,
      ),
    ).rejects.toThrow('already has a step at that position');
    expect(stepRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a non-finite requested position before taking sequence locks', async () => {
    const getRepository = jest.fn();
    const service = new SequenceMutationSerializationService(
      { getRepository } as unknown as GlobalWorkspaceOrmManager,
      {} as SequenceInvariantService,
    );

    await expect(
      service.serializeStepUpdate({
        authContext,
        requestedPosition: Number.NaN,
        stepId: 'step-id',
        workspaceEntityManager,
      }),
    ).rejects.toThrow('position must be non-negative');
    expect(getRepository).not.toHaveBeenCalled();
  });

  it('rejects a cross-sequence move into an occupied root position without moving the occupant', async () => {
    const currentStep = {
      id: 'moving-step-id',
      sequenceId: 'source-sequence-id',
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const occupyingStep = {
      ...currentStep,
      id: 'target-step-id',
      sequenceId: 'target-sequence-id',
      position: 1,
      settings: {
        ...currentStep.settings,
        branch: null,
      },
    } as unknown as SequenceStepWorkspaceEntity;
    const stepRepository = {
      findOne: jest.fn().mockResolvedValue(currentStep),
      find: jest.fn().mockResolvedValue([occupyingStep]),
      update: jest.fn(),
    };
    const sequenceRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          { id: currentStep.sequenceId },
          { id: occupyingStep.sequenceId },
        ]),
    };
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(async (_workspaceId, entity) =>
        entity === SequenceStepWorkspaceEntity
          ? stepRepository
          : sequenceRepository,
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const invariantService = {
      assertStepUpdateAllowed: jest.fn(),
    } as unknown as SequenceInvariantService;
    const service = new SequenceMutationSerializationService(
      globalWorkspaceOrmManager,
      invariantService,
    );

    await expect(
      service.serializeStepUpdate({
        authContext,
        nextSequenceId: occupyingStep.sequenceId,
        requestedPosition: occupyingStep.position,
        stepId: currentStep.id,
        workspaceEntityManager,
      }),
    ).rejects.toThrow('already has a step at that position');
    expect(stepRepository.update).not.toHaveBeenCalled();
  });
});
