import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_WAITING_ON,
  TASK_PRIORITIES,
} from 'twenty-shared/types';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceExecutorService', () => {
  const workspaceId = 'workspace-id';
  const enrollmentId = 'enrollment-id';
  const stepId = 'step-id';
  const enrollment = {
    id: enrollmentId,
    sequenceId: 'sequence-id',
    personId: 'person-id',
    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    currentStepId: null,
    currentStepPosition: -1,
    waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
    nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
    senderConnectedAccountId: 'connected-account-id',
    stopOnReply: true,
    sentEmailsByStepId: {},
    lastSendAttempt: null,
  } as SequenceEnrollmentWorkspaceEntity;
  const sequence = {
    id: 'sequence-id',
    status: SEQUENCE_STATUSES.ACTIVE,
    senderConnectedAccountId: 'connected-account-id',
    settings: {
      ...DEFAULT_SEQUENCE_SETTINGS,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      windowStart: '00:00',
      windowEnd: '23:59',
      staggerMinutes: 0,
    },
  } as SequenceWorkspaceEntity;
  const step = {
    id: stepId,
    sequenceId: 'sequence-id',
    position: 0,
    type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
    settings: {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Hello {{firstName}}',
      bodyHtml: '<p>Hello {{firstName}}</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
    },
  } as SequenceStepWorkspaceEntity;

  const buildPerson = (emailOptOut = false) =>
    ({
      id: 'person-id',
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      emails: {
        primaryEmail: 'ada@example.com',
        additionalEmails: null,
      },
      emailOptOut,
      company: null,
    }) as PersonWorkspaceEntity;

  const setup = ({
    currentEnrollment = enrollment,
    currentSequence = sequence,
    person = buildPerson(),
    steps = [step],
  }: {
    currentEnrollment?: SequenceEnrollmentWorkspaceEntity;
    currentSequence?: SequenceWorkspaceEntity;
    person?: PersonWorkspaceEntity;
    steps?: SequenceStepWorkspaceEntity[];
  } = {}) => {
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(currentEnrollment),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue(currentSequence),
    };
    const stepRepository = {
      find: jest.fn().mockResolvedValue(steps),
    };
    const personRepository = {
      findOne: jest.fn().mockResolvedValue(person),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
    ]);
    const transactionManager = {} as WorkspaceEntityManager;
    const transaction = jest.fn(
      async (callback: (manager: WorkspaceEntityManager) => Promise<void>) =>
        callback(transactionManager),
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction,
      }),
      getRepository: jest.fn(
        async (_workspaceId: string, entity: object) =>
          repositories.get(entity) ?? {},
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const send = jest.fn().mockResolvedValue({
      headerMessageId: 'header-message-id',
      threadExternalId: 'thread-external-id',
    });
    const sequenceEmailSenderService = {
      send,
    } as unknown as SequenceEmailSenderService;
    const createTask = jest.fn();
    const sequenceTaskCreatorService = {
      createTask,
    } as unknown as SequenceTaskCreatorService;
    const acquireSendLock = jest.fn().mockResolvedValue(true);
    const releaseSendLock = jest.fn();
    const getLastSendAt = jest.fn().mockResolvedValue(null);
    const setLastSendAt = jest.fn();
    const sequenceMailboxThrottleService = {
      acquireSendLock,
      releaseSendLock,
      getLastSendAt,
      setLastSendAt,
    } as unknown as SequenceMailboxThrottleService;
    const service = new SequenceExecutorService(
      globalWorkspaceOrmManager,
      sequenceEmailSenderService,
      sequenceTaskCreatorService,
      sequenceMailboxThrottleService,
    );

    return {
      service,
      enrollmentRepository,
      send,
      createTask,
      transaction,
      transactionManager,
      acquireSendLock,
      releaseSendLock,
      getLastSendAt,
      setLastSendAt,
    };
  };

  it('claims the email step before sending and advances only after success', async () => {
    const { service, enrollmentRepository, send } = setup();

    send.mockImplementation(async () => {
      expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          currentStepId: stepId,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: expect.any(Date),
          lastSendAttempt: expect.objectContaining({ stepId }),
        }),
      );
      const claimUpdate = enrollmentRepository.update.mock.calls[0][1];

      expect(claimUpdate.nextActionAt.getTime()).toBe(
        Date.parse(claimUpdate.lastSendAttempt.attemptedAt) +
          SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
      );
      expect(enrollmentRepository.update.mock.calls[0][1]).not.toHaveProperty(
        'currentStepPosition',
      );

      return {
        headerMessageId: 'header-message-id',
        threadExternalId: 'thread-external-id',
      };
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        currentStepPosition: 0,
        sentEmailsByStepId: {
          [stepId]: expect.objectContaining({
            headerMessageId: 'header-message-id',
            threadExternalId: 'thread-external-id',
          }),
        },
      }),
    );
  });

  it('fails opted-out people without claiming or sending', async () => {
    const { service, enrollmentRepository, send } = setup({
      person: buildPerson(true),
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.EMAIL_OPT_OUT,
      }),
    );
  });

  it('fails an expired claimed send without replaying it', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        lastSendAttempt: {
          stepId,
          attemptedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.SEND_INTERRUPTED,
      }),
    );
  });

  it('ignores a duplicate worker while the send claim lease is fresh', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date(
          Date.now() + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
        ),
        lastSendAttempt: {
          stepId,
          attemptedAt: new Date().toISOString(),
        },
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('leaves an expired send claim untouched while the sequence is paused', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
        lastSendAttempt: {
          stepId,
          attemptedAt: '2020-01-01T00:00:00.000Z',
        },
      },
      currentSequence: {
        ...sequence,
        status: SEQUENCE_STATUSES.PAUSED,
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not send when another worker wins the email claim', async () => {
    const { service, enrollmentRepository, send, setLastSendAt } = setup();

    enrollmentRepository.update.mockResolvedValueOnce({ affected: 0 });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(setLastSendAt).not.toHaveBeenCalled();
  });

  it('reschedules against the actual mailbox send floor', async () => {
    const lastSendAt = new Date();
    const { service, enrollmentRepository, send, getLastSendAt } = setup({
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          staggerMinutes: 5,
        },
      },
    });

    getLastSendAt.mockResolvedValue(lastSendAt);

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      }),
      {
        nextActionAt: new Date(lastSendAt.getTime() + 5 * 60 * 1000),
      },
    );
  });

  it.each([
    {
      label: 'a future delay',
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
      nextActionAt: new Date(Date.now() + 20_000),
    },
    {
      label: 'task completion',
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      nextActionAt: null,
    },
  ])('ignores a stale job while waiting on $label', async (waitingState) => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: waitingState.waitingOn,
        nextActionAt: waitingState.nextActionAt,
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not send a due email until the scheduler authorizes it', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('creates the task and advances the enrollment in one transaction', async () => {
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Follow up',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'IMMEDIATE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, createTask, transactionManager } =
      setup({
        currentEnrollment: {
          ...enrollment,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
        },
        steps: [taskStep],
      });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepPosition: -1,
      }),
      expect.objectContaining({
        currentStepId: taskStep.id,
        currentStepPosition: taskStep.position,
      }),
      transactionManager,
    );
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        step: taskStep,
        entityManager: transactionManager,
      }),
    );
  });

  it('marks a task enrollment failed from the rolled-back cursor', async () => {
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Follow up',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'IMMEDIATE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [taskStep],
    });

    createTask.mockRejectedValue(new Error('task insert failed'));

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepPosition: -1,
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'task insert failed',
      }),
    );
  });
});
