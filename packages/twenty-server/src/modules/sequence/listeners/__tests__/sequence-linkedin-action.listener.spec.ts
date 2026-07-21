import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceLinkedinActionListener } from 'src/modules/sequence/listeners/sequence-linkedin-action.listener';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequenceLinkedinActionListener', () => {
  const setup = (affected = 1) => {
    const enrollmentUpdate = jest.fn().mockResolvedValue({ affected });
    const personUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, { update: enrollmentUpdate }],
      [PersonWorkspaceEntity, { update: personUpdate }],
    ]);
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getRepository: jest.fn(async (_workspaceId: string, entity: object) =>
        repositories.get(entity),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;

    return {
      listener: new SequenceLinkedinActionListener(
        globalWorkspaceOrmManager,
        sequenceQueueService,
      ),
      globalWorkspaceOrmManager,
      enrollmentUpdate,
      personUpdate,
      enqueueProcess,
    };
  };

  const buildPayload = (
    status: LinkedinActionWorkspaceEntity['status'],
    errorMessage: string | null = null,
  ): WorkspaceEventBatch<
    ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>
  > => {
    const before = {
      id: 'action-id',
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      sequenceEnrollmentId: 'enrollment-id',
      sequenceStepId: 'step-id',
      personId: 'person-id',
      connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
      errorMessage: null,
    } as LinkedinActionWorkspaceEntity;
    const after = { ...before, status, errorMessage };

    return {
      name: 'linkedinAction',
      workspaceId: 'workspace-id',
      objectMetadata: {} as FlatObjectMetadata,
      events: [
        {
          recordId: 'action-id',
          properties: { before, after },
        } as ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>,
      ],
    };
  };

  it.each([
    LINKEDIN_ACTION_STATUSES.COMPLETED,
    LINKEDIN_ACTION_STATUSES.SKIPPED,
  ])(
    'advances and enqueues an enrollment when an action becomes %s',
    async (status) => {
      const { listener, enrollmentUpdate, personUpdate, enqueueProcess } =
        setup();

      await listener.handleUpdatedEvent(buildPayload(status));

      expect(enrollmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'enrollment-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
          currentStepId: 'step-id',
        }),
        expect.objectContaining({
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: expect.any(Date),
        }),
      );
      expect(personUpdate).toHaveBeenCalledWith(
        { id: 'person-id' },
        { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.PENDING },
      );
      expect(enqueueProcess).toHaveBeenCalledWith({
        workspaceId: 'workspace-id',
        enrollmentId: 'enrollment-id',
      });
    },
  );

  it('fails an enrollment with the browser-reported error', async () => {
    const { listener, enrollmentUpdate, enqueueProcess } = setup();

    await listener.handleUpdatedEvent(
      buildPayload(LINKEDIN_ACTION_STATUSES.FAILED, 'Connect button not found'),
    );

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'enrollment-id' }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'Connect button not found',
      }),
    );
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('ignores non-terminal action updates', async () => {
    const { listener, globalWorkspaceOrmManager } = setup();

    await listener.handleUpdatedEvent(
      buildPayload(LINKEDIN_ACTION_STATUSES.SCHEDULED),
    );

    expect(
      globalWorkspaceOrmManager.executeInWorkspaceContext,
    ).not.toHaveBeenCalled();
  });
});
