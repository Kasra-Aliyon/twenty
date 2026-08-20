import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

describe('SequenceTaskCompletionService transaction serialization', () => {
  it('locks the sender owner after enrollment CAS and before completed history insert', async () => {
    const workspaceId = 'workspace-id';
    const transactionManager = {
      transactionMarker: true,
    } as unknown as WorkspaceEntityManager;
    const enrollment = {
      id: 'enrollment-id',
      sequenceId: 'sequence-id',
      personId: 'person-id',
      senderConnectedAccountId: 'connected-account-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      currentStepId: 'step-id',
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
    } as SequenceEnrollmentWorkspaceEntity;
    const step = {
      id: enrollment.currentStepId,
      sequenceId: enrollment.sequenceId,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        messageTemplate: 'Hello',
      },
    } as SequenceStepWorkspaceEntity;
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(enrollment),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepository = {
      findOne: jest.fn().mockResolvedValue(step),
    };
    const personRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: enrollment.personId,
        linkedinLink: {
          primaryLinkUrl: 'https://www.linkedin.com/in/example/',
        },
      }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue({
        senderConnectedAccountId: 'fallback-connected-account-id',
      }),
    };
    const linkedinActionRepository = {
      insert: jest.fn(),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
    ]);
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) =>
        repositories.get(entity),
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction: jest.fn(async (callback) => callback(transactionManager)),
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const getSenderOwnerWorkspaceMemberIdOrThrow = jest
      .fn()
      .mockResolvedValue('owner-workspace-member-id');
    const service = new SequenceTaskCompletionService(
      globalWorkspaceOrmManager,
      { enqueueProcess } as unknown as SequenceQueueService,
      {
        getSenderOwnerWorkspaceMemberIdOrThrow,
      } as unknown as SequenceSenderService,
    );

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
    });

    expect(getSenderOwnerWorkspaceMemberIdOrThrow).toHaveBeenCalledWith({
      connectedAccountId: enrollment.senderConnectedAccountId,
      workspaceEntityManager: transactionManager,
      workspaceId,
    });
    expect(
      enrollmentRepository.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      getSenderOwnerWorkspaceMemberIdOrThrow.mock.invocationCallOrder[0],
    );
    expect(
      getSenderOwnerWorkspaceMemberIdOrThrow.mock.invocationCallOrder[0],
    ).toBeLessThan(linkedinActionRepository.insert.mock.invocationCallOrder[0]);
    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        ownerWorkspaceMemberId: 'owner-workspace-member-id',
      }),
      transactionManager,
    );
  });

  it('locks enrollment before revalidating the committed task and advancing', async () => {
    const workspaceId = 'workspace-id';
    const commitCheckManager = {
      transactionMarker: 'commit-check',
    } as unknown as WorkspaceEntityManager;
    const advancementManager = {
      transactionMarker: 'advancement',
    } as unknown as WorkspaceEntityManager;
    const enrollment = {
      id: 'enrollment-id',
      sequenceId: 'sequence-id',
      personId: 'person-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      currentStepId: 'step-id',
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
    } as SequenceEnrollmentWorkspaceEntity;
    const step = {
      id: enrollment.currentStepId,
      sequenceId: enrollment.sequenceId,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: 'TODO',
        titleTemplate: 'Review',
        notesTemplate: '',
        priority: 'MEDIUM',
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(enrollment),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepository = {
      findOne: jest.fn().mockResolvedValue(step),
    };
    const taskRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'task-id' }),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [TaskWorkspaceEntity, taskRepository],
    ]);
    const transactionManagers = [commitCheckManager, advancementManager];
    const transaction = jest.fn(async (callback) => {
      const transactionManager = transactionManagers.shift();

      if (transactionManager === undefined) {
        throw new Error('Unexpected transaction');
      }

      return callback(transactionManager);
    });
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) =>
        repositories.get(entity),
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction,
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const service = new SequenceTaskCompletionService(
      globalWorkspaceOrmManager,
      { enqueueProcess } as unknown as SequenceQueueService,
      {} as SequenceSenderService,
    );

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
      taskId: 'task-id',
    });

    expect(taskRepository.findOne).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: 'task-id',
          status: 'DONE',
          sequenceEnrollmentId: enrollment.id,
          sequenceStepId: step.id,
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      commitCheckManager,
    );
    expect(enrollmentRepository.findOne).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: enrollment.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepId: step.id,
          waitingOn: expect.anything(),
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      advancementManager,
    );
    expect(taskRepository.findOne).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: 'task-id',
          status: 'DONE',
          sequenceEnrollmentId: enrollment.id,
          sequenceStepId: step.id,
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      advancementManager,
    );
    expect(
      enrollmentRepository.findOne.mock.invocationCallOrder[1],
    ).toBeLessThan(taskRepository.findOne.mock.invocationCallOrder[1]);
    expect(taskRepository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      enrollmentRepository.update.mock.invocationCallOrder[0],
    );
    expect(enqueueProcess).toHaveBeenCalledTimes(1);
  });
});
