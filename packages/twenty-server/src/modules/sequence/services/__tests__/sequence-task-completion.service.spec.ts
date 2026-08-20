import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { type FindOperator } from 'typeorm';

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

describe('SequenceTaskCompletionService', () => {
  const workspaceId = 'workspace-id';
  const enrollment = {
    id: 'enrollment-id',
    sequenceId: 'sequence-id',
    personId: 'person-id',
    senderConnectedAccountId: 'sender-id',
    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    currentStepId: 'step-id',
    waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
  } as SequenceEnrollmentWorkspaceEntity;
  const person = {
    id: enrollment.personId,
    linkedinLink: {
      primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
    },
  } as PersonWorkspaceEntity;

  const setup = ({
    step,
    affected = 1,
    committedTask = { id: 'task-id' },
    invitationActions = [],
  }: {
    step: SequenceStepWorkspaceEntity | null;
    affected?: number;
    committedTask?: Pick<TaskWorkspaceEntity, 'id'> | null;
    invitationActions?: Pick<
      LinkedinActionWorkspaceEntity,
      'id' | 'status' | 'type'
    >[];
  }) => {
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(enrollment),
      update: jest.fn().mockResolvedValue({ affected }),
    };
    const stepRepository = {
      findOne: jest.fn().mockResolvedValue(step),
    };
    const personRepository = {
      findOne: jest.fn().mockResolvedValue(person),
    };
    const linkedinActionRepository = {
      find: jest.fn().mockResolvedValue(invitationActions),
      insert: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue({
        senderConnectedAccountId: 'sequence-sender-id',
      }),
    };
    const taskRepository = {
      findOne: jest.fn().mockResolvedValue(committedTask),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
      [TaskWorkspaceEntity, taskRepository],
    ]);
    const transactionManager = {} as WorkspaceEntityManager;
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
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const getSenderOwnerWorkspaceMemberIdOrThrow = jest
      .fn()
      .mockResolvedValue('owner-id');
    const sequenceSenderService = {
      getSenderOwnerWorkspaceMemberIdOrThrow,
    } as unknown as SequenceSenderService;
    const service = new SequenceTaskCompletionService(
      globalWorkspaceOrmManager,
      sequenceQueueService,
      sequenceSenderService,
    );

    return {
      service,
      enrollmentRepository,
      stepRepository,
      personRepository,
      linkedinActionRepository,
      transactionManager,
      enqueueProcess,
      getSenderOwnerWorkspaceMemberIdOrThrow,
      taskRepository,
    };
  };

  it('records a completed manual LinkedIn message atomically before advancing', async () => {
    const step = {
      id: 'step-id',
      sequenceId: enrollment.sequenceId,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        messageTemplate: 'Hello Ada',
      },
    } as SequenceStepWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      transactionManager,
      enqueueProcess,
    } = setup({ step });

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
    });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollment.id,
        currentStepId: step.id,
        waitingOn: expect.anything(),
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
      transactionManager,
    );
    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        ownerWorkspaceMemberId: 'owner-id',
        personId: enrollment.personId,
        sequenceEnrollmentId: enrollment.id,
        sequenceStepId: step.id,
      }),
      transactionManager,
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: enrollment.id,
    });
  });

  it('serializes a manual invitation outcome with automated invitation admission', async () => {
    const step = {
      id: 'step-id',
      sequenceId: enrollment.sequenceId,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      personRepository,
      linkedinActionRepository,
      transactionManager,
    } = setup({ step });

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
    });

    expect(personRepository.findOne).toHaveBeenLastCalledWith(
      {
        where: { id: person.id },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(personRepository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      enrollmentRepository.update.mock.invocationCallOrder[0],
    );
    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
      }),
      transactionManager,
    );
  });

  it.each([
    {
      scheduledActionId: 'scheduled-send-id',
      scheduledActionType: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      manualActionType: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      manualConnectionState: LINKEDIN_CONNECTION_STATES.WITHDRAWN,
      manualStepType: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
    },
    {
      scheduledActionId: 'scheduled-withdraw-id',
      scheduledActionType: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      manualActionType: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      manualConnectionState: LINKEDIN_CONNECTION_STATES.PENDING,
      manualStepType: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
    },
    {
      scheduledActionId: 'scheduled-send-id',
      scheduledActionType: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      manualActionType: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      manualConnectionState: LINKEDIN_CONNECTION_STATES.PENDING,
      manualStepType: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
    },
    {
      scheduledActionId: 'scheduled-withdraw-id',
      scheduledActionType: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      manualActionType: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      manualConnectionState: LINKEDIN_CONNECTION_STATES.WITHDRAWN,
      manualStepType: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
    },
  ])(
    'cancels an automated $scheduledActionType before recording a completed manual $manualActionType',
    async ({
      scheduledActionId,
      scheduledActionType,
      manualActionType,
      manualConnectionState,
      manualStepType,
    }) => {
      const step = {
        id: 'step-id',
        sequenceId: enrollment.sequenceId,
        settings: {
          type: manualStepType,
          executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
          noteTemplate: '',
        },
      } as SequenceStepWorkspaceEntity;
      const {
        service,
        linkedinActionRepository,
        transactionManager,
        enqueueProcess,
        getSenderOwnerWorkspaceMemberIdOrThrow,
      } = setup({
        step,
        invitationActions: [
          {
            id: scheduledActionId,
            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
            type: scheduledActionType,
          },
        ],
      });

      await service.completeTaskStep({
        workspaceId,
        enrollmentId: enrollment.id,
        stepId: step.id,
      });

      expect(linkedinActionRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerWorkspaceMemberId: 'owner-id',
            personId: person.id,
            type: expect.anything(),
          }),
          select: ['id', 'status'],
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        }),
        transactionManager,
      );
      const invitationActionTypes = (
        linkedinActionRepository.find.mock.calls[0][0].where
          .type as FindOperator<string[]>
      ).value;

      expect(invitationActionTypes).toEqual([
        LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      ]);
      expect(linkedinActionRepository.update).toHaveBeenCalledWith(
        {
          id: scheduledActionId,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        },
        expect.objectContaining({
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: expect.stringContaining('manual'),
        }),
        transactionManager,
      );
      expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: manualActionType,
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          connectionState: manualConnectionState,
        }),
        transactionManager,
      );
      expect(
        linkedinActionRepository.update.mock.invocationCallOrder[0],
      ).toBeLessThan(
        linkedinActionRepository.insert.mock.invocationCallOrder[0],
      );
      expect(
        linkedinActionRepository.find.mock.invocationCallOrder[0],
      ).toBeLessThan(
        getSenderOwnerWorkspaceMemberIdOrThrow.mock.invocationCallOrder[1],
      );
      expect(enqueueProcess).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      claimedActionType: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      manualStepType: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
    },
    {
      claimedActionType: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      manualStepType: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
    },
    {
      claimedActionType: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      manualStepType: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
    },
    {
      claimedActionType: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      manualStepType: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
    },
  ])(
    'defers manual $manualStepType completion while an automated $claimedActionType is claimed',
    async ({ claimedActionType, manualStepType }) => {
      const step = {
        id: 'step-id',
        sequenceId: enrollment.sequenceId,
        settings: {
          type: manualStepType,
          executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
          noteTemplate: '',
        },
      } as SequenceStepWorkspaceEntity;
      const {
        service,
        enrollmentRepository,
        linkedinActionRepository,
        enqueueProcess,
      } = setup({
        step,
        invitationActions: [
          {
            id: 'claimed-action-id',
            status: LINKEDIN_ACTION_STATUSES.CLAIMED,
            type: claimedActionType,
          },
        ],
      });

      await service.completeTaskStep({
        workspaceId,
        enrollmentId: enrollment.id,
        stepId: step.id,
      });

      expect(linkedinActionRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: expect.anything() }),
          lock: { mode: 'pessimistic_write' },
        }),
        expect.anything(),
      );
      const invitationActionTypes = (
        linkedinActionRepository.find.mock.calls[0][0].where
          .type as FindOperator<string[]>
      ).value;

      expect(invitationActionTypes).toContain(claimedActionType);
      expect(linkedinActionRepository.update).not.toHaveBeenCalled();
      expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
      expect(enrollmentRepository.update).not.toHaveBeenCalled();
      expect(enqueueProcess).not.toHaveBeenCalled();
    },
  );

  it('advances an ordinary task without inventing a LinkedIn action', async () => {
    const step = {
      id: 'step-id',
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
    const { service, linkedinActionRepository, enqueueProcess } = setup({
      step,
    });

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
    });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enqueueProcess).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate history or enqueue when another worker wins the CAS', async () => {
    const step = {
      id: 'step-id',
      sequenceId: enrollment.sequenceId,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, linkedinActionRepository, enqueueProcess } = setup({
      step,
      affected: 0,
    });

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
    });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('does not advance when the source task completion was not committed', async () => {
    const step = {
      id: 'step-id',
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
    const {
      service,
      enrollmentRepository,
      enqueueProcess,
      taskRepository,
      transactionManager,
    } = setup({ step, committedTask: null });

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: step.id,
      taskId: 'task-id',
    });

    expect(taskRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task-id',
          status: 'DONE',
          sequenceEnrollmentId: enrollment.id,
          sequenceStepId: step.id,
        }),
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('does not terminally validate a missing step from a rolled-back task event', async () => {
    const { service, enrollmentRepository, stepRepository, enqueueProcess } =
      setup({ step: null, committedTask: null });

    await service.completeTaskStep({
      workspaceId,
      enrollmentId: enrollment.id,
      stepId: enrollment.currentStepId ?? 'step-id',
      taskId: 'task-id',
    });

    expect(stepRepository.findOne).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('propagates a transient history insert failure for scheduler recovery', async () => {
    const step = {
      id: 'step-id',
      sequenceId: enrollment.sequenceId,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        messageTemplate: 'Hello Ada',
      },
    } as SequenceStepWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      enqueueProcess,
    } = setup({ step });
    const databaseError = new Error('sequence history database unavailable');

    linkedinActionRepository.insert.mockRejectedValue(databaseError);

    await expect(
      service.completeTaskStep({
        workspaceId,
        enrollmentId: enrollment.id,
        stepId: step.id,
      }),
    ).rejects.toBe(databaseError);

    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
    expect(enqueueProcess).not.toHaveBeenCalled();
  });
});
