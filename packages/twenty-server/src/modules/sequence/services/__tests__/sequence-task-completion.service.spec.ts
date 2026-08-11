import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
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
  }: {
    step: SequenceStepWorkspaceEntity;
    affected?: number;
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
      insert: jest.fn(),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue({
        senderConnectedAccountId: 'sequence-sender-id',
      }),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
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
      linkedinActionRepository,
      transactionManager,
      enqueueProcess,
      getSenderOwnerWorkspaceMemberIdOrThrow,
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
        skipIfAlreadyConnected: true,
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
});
