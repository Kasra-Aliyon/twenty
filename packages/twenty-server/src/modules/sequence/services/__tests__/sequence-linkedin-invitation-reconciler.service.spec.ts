import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

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

  const setup = ({
    hasInvitation = true,
  }: { hasInvitation?: boolean } = {}) => {
    const actionFind = jest.fn().mockResolvedValue([action]);
    const actionUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const personFind = jest.fn().mockResolvedValue([person]);
    const personUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const invitationFind = jest
      .fn()
      .mockResolvedValue(hasInvitation ? [invitation] : []);
    const enrollmentUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const repositories = new Map<object, object>([
      [
        LinkedinActionWorkspaceEntity,
        { find: actionFind, update: actionUpdate },
      ],
      [PersonWorkspaceEntity, { find: personFind, update: personUpdate }],
      [LinkedinInvitationWorkspaceEntity, { find: invitationFind }],
      [SequenceEnrollmentWorkspaceEntity, { update: enrollmentUpdate }],
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
      actionUpdate,
      enrollmentUpdate,
      enqueueProcess,
      personUpdate,
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
      { id: person.id },
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

  it('keeps the failure when LinkedIn has no matching sent invitation', async () => {
    const {
      actionUpdate,
      enrollmentUpdate,
      enqueueProcess,
      personUpdate,
      service,
    } = setup({ hasInvitation: false });

    await service.reconcile({ workspaceId, now });

    expect(actionUpdate).not.toHaveBeenCalled();
    expect(personUpdate).not.toHaveBeenCalled();
    expect(enrollmentUpdate).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });
});
