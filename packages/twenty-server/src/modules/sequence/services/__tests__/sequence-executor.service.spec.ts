import {
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_BRANCHES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_WAITING_ON,
  TASK_PRIORITIES,
} from 'twenty-shared/types';

import { type ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { type SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { type SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
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
      linkedinConnectionState: LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
      linkedinLink: null,
      phones: {
        primaryPhoneNumber: '',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
      company: null,
    }) as unknown as PersonWorkspaceEntity;

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
    const linkedinActionRepository = {
      insert: jest.fn(),
    };
    const linkedinConnectionRepository = {
      count: jest.fn().mockResolvedValue(0),
    };
    const linkedinMessageRepository = {
      count: jest.fn().mockResolvedValue(0),
    };
    const linkedinThreadParticipantRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
      [LinkedinConnectionWorkspaceEntity, linkedinConnectionRepository],
      [LinkedinMessageWorkspaceEntity, linkedinMessageRepository],
      [
        LinkedinThreadParticipantWorkspaceEntity,
        linkedinThreadParticipantRepository,
      ],
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
    const reserveSlot = jest.fn().mockResolvedValue(new Date());
    const sequenceLinkedinThrottleService = {
      reserveSlot,
    } as unknown as SequenceLinkedinThrottleService;
    const getReadySenderOrThrow = jest.fn().mockResolvedValue({
      connectedAccount: { id: 'connected-account-id' },
      messageChannel: { id: 'message-channel-id' },
    });
    const getOwnerWorkspaceMemberIdOrThrow = jest
      .fn()
      .mockResolvedValue('owner-workspace-member-id');
    const sequenceSenderService = {
      getReadySenderOrThrow,
      getOwnerWorkspaceMemberIdOrThrow,
    } as unknown as SequenceSenderService;
    const buildVariables = jest.fn().mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const sequenceVariableService = {
      buildVariables,
    } as unknown as SequenceVariableService;
    const enrichPerson = jest.fn().mockResolvedValue('updated');
    const apolloEnrichmentService = {
      enrichPerson,
    } as unknown as ApolloEnrichmentService;
    const service = new SequenceExecutorService(
      globalWorkspaceOrmManager,
      sequenceEmailSenderService,
      sequenceTaskCreatorService,
      sequenceMailboxThrottleService,
      sequenceLinkedinThrottleService,
      sequenceSenderService,
      sequenceVariableService,
      apolloEnrichmentService,
    );

    return {
      service,
      enrollmentRepository,
      personRepository,
      send,
      createTask,
      transaction,
      transactionManager,
      acquireSendLock,
      releaseSendLock,
      getLastSendAt,
      setLastSendAt,
      linkedinActionRepository,
      linkedinConnectionRepository,
      linkedinMessageRepository,
      linkedinThreadParticipantRepository,
      reserveSlot,
      getReadySenderOrThrow,
      getOwnerWorkspaceMemberIdOrThrow,
      buildVariables,
      enrichPerson,
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

  it('turns a manual email step into a sequence task', async () => {
    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        manualTaskTitle: 'Write a personal note to {{ fullName }}',
        manualTaskDescription: 'Use the research in the contact record.',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, createTask, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          taskType: SEQUENCE_TASK_TYPES.EMAIL,
          titleTemplate: 'Write a personal note to {{ fullName }}',
          notesTemplate: 'Use the research in the contact record.',
          continueMode: 'ON_DONE',
        }),
      }),
    );
  });

  it('advances a condition so its branch can be evaluated next', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
    );
  });

  it('executes only the branch selected by the contact condition', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Phone available',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const noStep = {
      ...yesStep,
      id: 'no-step-id',
      position: 2,
      settings: {
        ...yesStep.settings,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.NO,
        },
        titleTemplate: 'Phone missing',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep, yesStep, noStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        step: noStep,
        settings: expect.objectContaining({
          titleTemplate: 'Phone missing',
        }),
      }),
    );
    expect(createTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ step: yesStep }),
    );
  });

  it('scopes LinkedIn activity conditions to the sender and message author', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'LinkedIn activity received',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const {
      service,
      createTask,
      linkedinMessageRepository,
      linkedinThreadParticipantRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep, yesStep],
    });

    linkedinThreadParticipantRepository.find.mockResolvedValue([
      {
        linkedinUrn: 'recipient-linkedin-urn',
        threadId: 'thread-id',
      },
    ]);
    linkedinMessageRepository.count.mockResolvedValue(1);

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinThreadParticipantRepository.find).toHaveBeenCalledWith({
      where: {
        personId: enrollment.personId,
        isSelf: false,
        ownerWorkspaceMemberId: 'owner-workspace-member-id',
      },
      select: ['linkedinUrn', 'threadId'],
    });
    expect(linkedinMessageRepository.count).toHaveBeenCalledWith({
      where: [
        {
          direction: 'INBOUND',
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          senderLinkedinUrn: 'recipient-linkedin-urn',
          threadId: 'thread-id',
        },
      ],
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ step: yesStep }),
    );
  });

  it('enriches a missing phone number through Apollo before continuing', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const person = buildPerson();
    const { service, enrollmentRepository, enrichPerson, personRepository } =
      setup({
        currentEnrollment: {
          ...enrollment,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
        },
        person,
        steps: [enrichStep],
      });

    personRepository.findOne
      .mockResolvedValueOnce(person)
      .mockResolvedValueOnce({
        ...person,
        phones: {
          ...person.phones,
          primaryPhoneNumber: '+358401234567',
        },
      });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).toHaveBeenCalledWith({
      workspaceId,
      personId: person.id,
    });
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        currentStepId: enrichStep.id,
        currentStepPosition: enrichStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
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

  it('fails a connection request when the person has no LinkedIn URL', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: 'Hi {{ firstName }}',
        skipIfAlreadyConnected: true,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [connectionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
      }),
    );
  });

  it('renders and schedules a direct LinkedIn message', async () => {
    const messageStep = {
      id: 'message-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        messageTemplate: 'Hi {{ firstName }}, thanks for connecting.',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, transactionManager } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [messageStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SEND_MESSAGE',
        linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        noteText: 'Hi Ada, thanks for connecting.',
        ownerWorkspaceMemberId: 'owner-workspace-member-id',
      }),
      transactionManager,
    );
  });

  it('floors a withdrawal slot at the configured custom delay', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
    const withdrawStep = {
      id: 'withdraw-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        withdrawAfterDays: 1,
        withdrawAfterHours: 2,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      reserveSlot,
      linkedinActionRepository,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [withdrawStep],
    });

    reserveSlot.mockImplementation(async ({ now }: { now: Date }) => now);

    await service.process({ workspaceId, enrollmentId });

    expect(reserveSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date('2026-07-21T11:00:00.000Z'),
      }),
    );
    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        scheduledAt: new Date('2026-07-21T11:00:00.000Z'),
      }),
      transactionManager,
    );

    jest.useRealTimers();
  });
});
