import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { In } from 'typeorm';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceLinkedinActionListener } from 'src/modules/sequence/listeners/sequence-linkedin-action.listener';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import {
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequenceLinkedinActionListener', () => {
  const buildAction = (
    status: LinkedinActionWorkspaceEntity['status'],
    errorMessage: string | null = null,
    type: LinkedinActionWorkspaceEntity['type'] = LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
  ): LinkedinActionWorkspaceEntity =>
    ({
      id: 'action-id',
      status,
      sequenceEnrollmentId: 'enrollment-id',
      sequenceStepId: 'step-id',
      personId: 'person-id',
      type,
      ownerWorkspaceMemberId: 'owner-id',
      executedAt: new Date('2026-07-24T11:00:00.000Z'),
      connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
      errorMessage,
    }) as LinkedinActionWorkspaceEntity;

  const setup = ({
    affected = 1,
    committedActions = [buildAction(LINKEDIN_ACTION_STATUSES.COMPLETED)],
  }: {
    affected?: number;
    committedActions?: LinkedinActionWorkspaceEntity[];
  } = {}) => {
    const enrollmentUpdate = jest.fn().mockResolvedValue({ affected });
    const personUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const actionFind = jest.fn().mockResolvedValue(committedActions);
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, { update: enrollmentUpdate }],
      [PersonWorkspaceEntity, { update: personUpdate }],
      [LinkedinActionWorkspaceEntity, { find: actionFind }],
    ]);
    const transactionManager = {};
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<unknown>) => callback(),
      ),
      getRepository: jest.fn(async (_workspaceId: string, entity: object) =>
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
    const reconcileCompletedOutboundActions = jest.fn();
    const sequenceLinkedinReplyListener = {
      reconcileCompletedOutboundActions,
    } as unknown as SequenceLinkedinReplyListener;

    return {
      listener: new SequenceLinkedinActionListener(
        globalWorkspaceOrmManager,
        sequenceQueueService,
        sequenceLinkedinReplyListener,
      ),
      globalWorkspaceOrmManager,
      actionFind,
      enrollmentUpdate,
      personUpdate,
      enqueueProcess,
      reconcileCompletedOutboundActions,
    };
  };

  const buildPayload = (
    status: LinkedinActionWorkspaceEntity['status'],
    errorMessage: string | null = null,
    type: LinkedinActionWorkspaceEntity['type'] = LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
  ): WorkspaceEventBatch<
    ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>
  > => {
    const before = buildAction(LINKEDIN_ACTION_STATUSES.CLAIMED, null, type);
    const after = buildAction(status, errorMessage, type);

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
        setup({ committedActions: [buildAction(status)] });

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
        {
          id: 'person-id',
          linkedinConnectionState: In([
            LINKEDIN_CONNECTION_STATES.UNKNOWN,
            LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
            LINKEDIN_CONNECTION_STATES.PENDING,
          ]),
        },
        { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.PENDING },
      );
      expect(enqueueProcess).toHaveBeenCalledWith({
        workspaceId: 'workspace-id',
        enrollmentId: 'enrollment-id',
      });
    },
  );

  it('advances a pre-start skip while preserving its null provider timestamp', async () => {
    const skippedAction = {
      ...buildAction(LINKEDIN_ACTION_STATUSES.SKIPPED),
      executedAt: null,
    } as LinkedinActionWorkspaceEntity;
    const { listener, enrollmentUpdate, enqueueProcess } = setup({
      committedActions: [skippedAction],
    });

    await listener.handleUpdatedEvent(
      buildPayload(LINKEDIN_ACTION_STATUSES.SKIPPED),
    );

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'enrollment-id' }),
      expect.objectContaining({ waitingOn: SEQUENCE_WAITING_ON.DELAY }),
    );
    expect(enqueueProcess).toHaveBeenCalled();
  });

  it.each([
    LINKEDIN_CONNECTION_STATES.CONNECTED,
    LINKEDIN_CONNECTION_STATES.WITHDRAWN,
  ])(
    'does not let an older PENDING completion overwrite newer %s truth',
    async () => {
      const { listener, personUpdate } = setup();

      await listener.handleUpdatedEvent(
        buildPayload(LINKEDIN_ACTION_STATUSES.COMPLETED),
      );

      expect(personUpdate).toHaveBeenCalledWith(
        {
          id: 'person-id',
          linkedinConnectionState: In([
            LINKEDIN_CONNECTION_STATES.UNKNOWN,
            LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
            LINKEDIN_CONNECTION_STATES.PENDING,
          ]),
        },
        { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.PENDING },
      );
    },
  );

  it('fails an enrollment with the browser-reported error', async () => {
    const { listener, enrollmentUpdate, enqueueProcess } = setup({
      committedActions: [
        buildAction(
          LINKEDIN_ACTION_STATUSES.FAILED,
          'Connect button not found',
        ),
      ],
    });

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

  it('leaves an atomically failed exhausted waiter unchanged when the delayed event arrives', async () => {
    const { listener, enrollmentUpdate, enqueueProcess } = setup({
      affected: 0,
      committedActions: [
        buildAction(
          LINKEDIN_ACTION_STATUSES.FAILED,
          SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
        ),
      ],
    });

    await listener.handleUpdatedEvent(
      buildPayload(
        LINKEDIN_ACTION_STATUSES.FAILED,
        SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
      ),
    );

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'enrollment-id',
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      }),
      expect.objectContaining({ status: SEQUENCE_ENROLLMENT_STATUSES.FAILED }),
    );
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it.each([
    LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
    LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
  ])(
    'reconciles inbound messages before advancing a completed %s action',
    async (type) => {
      const { listener, enrollmentUpdate, reconcileCompletedOutboundActions } =
        setup({
          committedActions: [
            buildAction(LINKEDIN_ACTION_STATUSES.COMPLETED, null, type),
          ],
        });

      await listener.handleUpdatedEvent(
        buildPayload(LINKEDIN_ACTION_STATUSES.COMPLETED, null, type),
      );

      expect(reconcileCompletedOutboundActions).toHaveBeenCalledWith({
        actions: [
          expect.objectContaining({
            id: 'action-id',
            status: LINKEDIN_ACTION_STATUSES.COMPLETED,
            type,
          }),
        ],
        workspaceId: 'workspace-id',
      });
      expect(
        reconcileCompletedOutboundActions.mock.invocationCallOrder[0],
      ).toBeLessThan(enrollmentUpdate.mock.invocationCallOrder[0]);
    },
  );

  it('ignores non-terminal action updates', async () => {
    const { listener, globalWorkspaceOrmManager } = setup();

    await listener.handleUpdatedEvent(
      buildPayload(LINKEDIN_ACTION_STATUSES.SCHEDULED),
    );

    expect(
      globalWorkspaceOrmManager.executeInWorkspaceContext,
    ).not.toHaveBeenCalled();
  });

  it('ignores a terminal event when the source update rolled back', async () => {
    const {
      listener,
      actionFind,
      enrollmentUpdate,
      personUpdate,
      enqueueProcess,
      reconcileCompletedOutboundActions,
    } = setup({ committedActions: [] });

    await listener.handleUpdatedEvent(
      buildPayload(LINKEDIN_ACTION_STATUSES.COMPLETED),
    );

    expect(actionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: In(['action-id']) },
        lock: { mode: 'pessimistic_write' },
      }),
      expect.anything(),
    );
    expect(reconcileCompletedOutboundActions).not.toHaveBeenCalled();
    expect(personUpdate).not.toHaveBeenCalled();
    expect(enrollmentUpdate).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it.each([
    SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
    SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
    SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
  ])(
    'ignores a delayed pause cancellation event with marker %s',
    async (errorMessage) => {
      const { listener, globalWorkspaceOrmManager, enrollmentUpdate } = setup();

      await listener.handleUpdatedEvent(
        buildPayload(LINKEDIN_ACTION_STATUSES.CANCELLED, errorMessage),
      );

      expect(
        globalWorkspaceOrmManager.executeInWorkspaceContext,
      ).not.toHaveBeenCalled();
      expect(enrollmentUpdate).not.toHaveBeenCalled();
    },
  );
});
