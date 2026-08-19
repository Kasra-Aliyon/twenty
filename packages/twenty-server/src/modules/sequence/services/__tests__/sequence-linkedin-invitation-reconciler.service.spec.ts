import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { In } from 'typeorm';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinInvitationWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-invitation.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import {
  LINKEDIN_STALE_CONNECT_CONFIRMATION_ERRORS,
  SequenceLinkedinInvitationReconcilerService,
} from 'src/modules/sequence/services/sequence-linkedin-invitation-reconciler.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceLinkedinInvitationReconcilerService', () => {
  const workspaceId = 'workspace-id';
  const now = new Date('2026-08-13T09:00:00.000Z');
  const executedAt = new Date('2026-08-13T08:59:30.000Z');
  const action = {
    id: 'action-id',
    personId: 'person-id',
    sequenceEnrollmentId: 'enrollment-id',
    ownerWorkspaceMemberId: 'owner-id',
    type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
    status: LINKEDIN_ACTION_STATUSES.FAILED,
    executedAt,
    errorMessage: LINKEDIN_STALE_CONNECT_CONFIRMATION_ERRORS[0],
  } as LinkedinActionWorkspaceEntity;
  const person = {
    id: action.personId,
    linkedinLink: {
      primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
    },
  } as PersonWorkspaceEntity;
  const invitation = {
    id: 'invitation-id',
    direction: 'SENT',
    handle: 'ada-lovelace',
    ownerWorkspaceMemberId: action.ownerWorkspaceMemberId,
    sentAt: new Date('2026-08-13T08:59:40.000Z'),
  } as LinkedinInvitationWorkspaceEntity;
  const sequence = {
    id: 'sequence-id',
    status: SEQUENCE_STATUSES.ACTIVE,
    deletedAt: null,
  } as SequenceWorkspaceEntity;
  const enrollment = {
    id: action.sequenceEnrollmentId,
    sequenceId: sequence.id,
    status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
    errorMessage: action.errorMessage,
  } as SequenceEnrollmentWorkspaceEntity;

  const setup = ({
    hasInvitation = true,
    sequenceDeletedAt = null,
    sequenceStatus = SEQUENCE_STATUSES.ACTIVE,
  }: {
    hasInvitation?: boolean;
    sequenceDeletedAt?: string | null;
    sequenceStatus?: string;
  } = {}) => {
    const actionFind = jest.fn().mockResolvedValue([action]);
    const actionFindOne = jest.fn().mockResolvedValue(action);
    const actionUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const personFind = jest.fn().mockResolvedValue([person]);
    const personUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const invitationFind = jest
      .fn()
      .mockResolvedValue(hasInvitation ? [invitation] : []);
    const enrollmentFind = jest.fn().mockResolvedValue([enrollment]);
    const enrollmentFindOne = jest.fn().mockResolvedValue(enrollment);
    const enrollmentUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const sequenceFindOne = jest.fn().mockResolvedValue({
      ...sequence,
      deletedAt: sequenceDeletedAt,
      status: sequenceStatus,
    });
    const repositories = new Map<object, object>([
      [
        LinkedinActionWorkspaceEntity,
        { find: actionFind, findOne: actionFindOne, update: actionUpdate },
      ],
      [PersonWorkspaceEntity, { find: personFind, update: personUpdate }],
      [LinkedinInvitationWorkspaceEntity, { find: invitationFind }],
      [
        SequenceEnrollmentWorkspaceEntity,
        {
          find: enrollmentFind,
          findOne: enrollmentFindOne,
          update: enrollmentUpdate,
        },
      ],
      [SequenceWorkspaceEntity, { findOne: sequenceFindOne }],
    ]);
    const transaction = jest.fn(async (callback) => callback({}));
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<string[]>) => callback(),
      ),
      getRepository: jest.fn(async (_workspaceId: string, entity: object) =>
        repositories.get(entity),
      ),
      getGlobalWorkspaceDataSource: jest
        .fn()
        .mockResolvedValue({ transaction }),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;

    return {
      actionFind,
      actionFindOne,
      actionUpdate,
      enrollmentFind,
      enrollmentFindOne,
      enrollmentUpdate,
      enqueueProcess,
      invitationFind,
      personFind,
      personUpdate,
      sequenceFindOne,
      service: new SequenceLinkedinInvitationReconcilerService(
        globalWorkspaceOrmManager,
        sequenceQueueService,
      ),
    };
  };

  it('recovers a false failure when the sent-invitation sync confirms it', async () => {
    const {
      actionUpdate,
      enrollmentUpdate,
      enqueueProcess,
      personUpdate,
      service,
    } = setup();

    await service.reconcile({ workspaceId, now });

    expect(actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.FAILED,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        errorMessage: null,
      },
      expect.anything(),
    );
    expect(personUpdate).toHaveBeenCalledWith(
      {
        id: person.id,
        linkedinConnectionState: In([
          LINKEDIN_CONNECTION_STATES.UNKNOWN,
          LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
          LINKEDIN_CONNECTION_STATES.PENDING,
        ]),
      },
      { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.PENDING },
      expect.anything(),
    );
    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.sequenceEnrollmentId,
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
      {
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: now,
        endedAt: null,
        errorMessage: null,
      },
      expect.anything(),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: action.sequenceEnrollmentId,
    });
  });

  it('matches each failed action against its own execution window', async () => {
    const laterAction = {
      ...action,
      id: 'later-action-id',
      executedAt: new Date(executedAt.getTime() + 60 * 60 * 1000),
    } as LinkedinActionWorkspaceEntity;
    const { actionFind, actionUpdate, invitationFind, service } = setup();

    actionFind.mockResolvedValue([action, laterAction]);
    invitationFind.mockResolvedValue([invitation]);

    await service.reconcile({ workspaceId, now });

    const recoveredActionIds = actionUpdate.mock.calls.flatMap(
      ([criteria, data]) =>
        data.status === LINKEDIN_ACTION_STATUSES.COMPLETED ? [criteria.id] : [],
    );

    expect(recoveredActionIds).toEqual([action.id]);
  });

  it('does not recover an enrollment under an archived sequence', async () => {
    const {
      actionUpdate,
      enrollmentUpdate,
      enqueueProcess,
      sequenceFindOne,
      service,
    } = setup({ sequenceDeletedAt: '2026-08-13T08:59:45.000Z' });

    await service.reconcile({ workspaceId, now });

    expect(sequenceFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      expect.anything(),
    );
    expect(actionUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      }),
      expect.anything(),
    );
    expect(enrollmentUpdate).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('repairs durable state while paused without enqueueing execution', async () => {
    const { actionUpdate, enrollmentUpdate, enqueueProcess, service } = setup({
      sequenceStatus: SEQUENCE_STATUSES.PAUSED,
    });

    await service.reconcile({ workspaceId, now });

    expect(actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      }),
      expect.anything(),
    );
    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollment.id }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      }),
      expect.anything(),
    );
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('locks sequence then enrollment then action before recovery writes', async () => {
    const { actionFindOne, enrollmentFindOne, sequenceFindOne, service } =
      setup();

    await service.reconcile({ workspaceId, now });

    expect(sequenceFindOne.mock.invocationCallOrder[0]).toBeLessThan(
      enrollmentFindOne.mock.invocationCallOrder[0],
    );
    expect(enrollmentFindOne.mock.invocationCallOrder[0]).toBeLessThan(
      actionFindOne.mock.invocationCallOrder[0],
    );
  });

  it('keeps the failure when LinkedIn has no matching sent invitation', async () => {
    const {
      actionUpdate,
      enrollmentUpdate,
      enqueueProcess,
      personUpdate,
      service,
    } = setup({ hasInvitation: false });

    await service.reconcile({ workspaceId, now });

    expect(actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.anything(),
        status: LINKEDIN_ACTION_STATUSES.FAILED,
      }),
      { updatedAt: now.toISOString() },
    );
    expect(actionUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      }),
      expect.anything(),
    );
    expect(personUpdate).not.toHaveBeenCalled();
    expect(enrollmentUpdate).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('rotates a full unresolved batch so a later confirmed action is repaired', async () => {
    const unresolvedActions = Array.from(
      { length: 100 },
      (_, index) =>
        ({
          ...action,
          id: `unresolved-action-${index}`,
          personId: `missing-person-${index}`,
        }) as LinkedinActionWorkspaceEntity,
    );
    const { actionFind, actionUpdate, enqueueProcess, personFind, service } =
      setup();

    actionFind
      .mockReset()
      .mockResolvedValueOnce(unresolvedActions)
      .mockResolvedValueOnce([action]);
    personFind
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([person]);

    await service.reconcile({ workspaceId, now });
    await service.reconcile({
      workspaceId,
      now: new Date(now.getTime() + 60_000),
    });

    expect(actionFind).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        order: { updatedAt: 'ASC', id: 'ASC' },
        take: 100,
      }),
    );
    expect(actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.anything(),
        status: LINKEDIN_ACTION_STATUSES.FAILED,
      }),
      { updatedAt: now.toISOString() },
    );
    expect(actionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      }),
      expect.anything(),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: action.sequenceEnrollmentId,
    });
  });
});
