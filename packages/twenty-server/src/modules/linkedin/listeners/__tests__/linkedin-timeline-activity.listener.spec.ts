import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
} from 'twenty-shared/types';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinTimelineActivityListener } from 'src/modules/linkedin/listeners/linkedin-timeline-activity.listener';
import { type LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { type LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { type TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const PERSON_ID = '20202020-2222-4222-8222-222222222222';

describe('LinkedinTimelineActivityListener', () => {
  const setup = ({
    messages = [],
    participants = [],
  }: {
    messages?: LinkedinMessageWorkspaceEntity[];
    participants?: LinkedinThreadParticipantWorkspaceEntity[];
  } = {}) => {
    const upsertTimelineActivities = jest.fn();
    const repositories = new Map<string, object>([
      ['linkedinMessage', { find: jest.fn().mockResolvedValue(messages) }],
      [
        'linkedinThreadParticipant',
        { find: jest.fn().mockResolvedValue(participants) },
      ],
    ]);
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<unknown>) => callback(),
      ),
      getRepository: jest.fn(async (_workspaceId: string, objectName: string) =>
        repositories.get(objectName),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const timelineActivityRepository = {
      upsertTimelineActivities,
    } as unknown as TimelineActivityRepository;

    return {
      listener: new LinkedinTimelineActivityListener(
        globalWorkspaceOrmManager,
        timelineActivityRepository,
      ),
      upsertTimelineActivities,
    };
  };

  const buildPayload = <T>(
    name: string,
    events: T[],
  ): WorkspaceEventBatch<T> => ({
    events,
    name,
    objectMetadata: {} as FlatObjectMetadata,
    workspaceId: WORKSPACE_ID,
  });

  const buildAction = ({
    connectionState = LINKEDIN_CONNECTION_STATES.PENDING,
    status = LINKEDIN_ACTION_STATUSES.COMPLETED,
    type = LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
  }: Partial<
    Pick<LinkedinActionWorkspaceEntity, 'connectionState' | 'status' | 'type'>
  > = {}) =>
    ({
      connectionState,
      executedAt: new Date('2026-08-13T09:00:00.000Z'),
      id: 'action-id',
      ownerWorkspaceMemberId: 'workspace-member-id',
      personId: PERSON_ID,
      status,
      type,
      updatedAt: '2026-08-13T09:00:00.000Z',
    }) as LinkedinActionWorkspaceEntity;

  it.each([
    [
      LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      LINKEDIN_CONNECTION_STATES.PENDING,
      'linkedin.connection-request-sent',
    ],
    [
      LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      LINKEDIN_CONNECTION_STATES.CONNECTED,
      'linkedin.message-sent',
    ],
    [
      LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      LINKEDIN_CONNECTION_STATES.WITHDRAWN,
      'linkedin.connection-request-withdrawn',
    ],
  ])('records completed %s actions', async (type, connectionState, name) => {
    const { listener, upsertTimelineActivities } = setup();

    await listener.handleActionCreatedEvent(
      buildPayload('linkedinAction', [
        {
          recordId: 'action-id',
          properties: { after: buildAction({ connectionState, type }) },
        } as ObjectRecordCreateEvent<LinkedinActionWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).toHaveBeenCalledWith({
      objectSingularName: 'person',
      payloads: [
        expect.objectContaining({
          happensAt: new Date('2026-08-13T09:00:00.000Z'),
          id: expect.any(String),
          name,
          recordId: PERSON_ID,
          workspaceMemberId: 'workspace-member-id',
        }),
      ],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('records an action only when it changes to a confirmed completed state', async () => {
    const { listener, upsertTimelineActivities } = setup();
    const before = buildAction({ status: LINKEDIN_ACTION_STATUSES.CLAIMED });
    const completed = buildAction();
    const skipped = buildAction({ status: LINKEDIN_ACTION_STATUSES.SKIPPED });

    await listener.handleActionUpdatedEvent(
      buildPayload('linkedinAction', [
        {
          recordId: 'action-id',
          properties: { after: completed, before },
        } as ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>,
        {
          recordId: 'skipped-action-id',
          properties: { after: skipped, before },
        } as ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).toHaveBeenCalledTimes(1);
    expect(upsertTimelineActivities).toHaveBeenCalledWith(
      expect.objectContaining({ payloads: [expect.objectContaining({})] }),
    );
  });

  it('uses the same activity identity when a source event is replayed', async () => {
    const { listener, upsertTimelineActivities } = setup();
    const payload = buildPayload('linkedinAction', [
      {
        recordId: 'action-id',
        properties: { after: buildAction() },
      } as ObjectRecordCreateEvent<LinkedinActionWorkspaceEntity>,
    ]);

    await listener.handleActionCreatedEvent(payload);
    await listener.handleActionCreatedEvent(payload);

    expect(upsertTimelineActivities.mock.calls[0][0].payloads[0].id).toBe(
      upsertTimelineActivities.mock.calls[1][0].payloads[0].id,
    );
  });

  it('records when the matched person becomes a LinkedIn connection', async () => {
    const { listener, upsertTimelineActivities } = setup();
    const connectedAt = new Date('2026-08-13T09:10:00.000Z');
    const connection = {
      connectedAt,
      createdAt: '2026-08-13T09:00:00.000Z',
      id: 'connection-id',
      ownerWorkspaceMemberId: 'workspace-member-id',
      personId: PERSON_ID,
    } as LinkedinConnectionWorkspaceEntity;

    await listener.handleConnectionCreatedEvent(
      buildPayload('linkedinConnection', [
        {
          recordId: connection.id,
          properties: { after: connection },
        } as ObjectRecordCreateEvent<LinkedinConnectionWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            happensAt: connectedAt,
            name: 'linkedin.connection-established',
            recordId: PERSON_ID,
          }),
        ],
      }),
    );
  });

  it('links an inbound message only to its matched sender in a group thread', async () => {
    const message = {
      deliveredAt: new Date('2026-08-13T09:05:00.000Z'),
      direction: 'INBOUND',
      id: 'message-id',
      ownerWorkspaceMemberId: 'workspace-member-id',
      senderLinkedinUrn: 'urn:li:person:sender',
      threadId: 'thread-id',
    } as LinkedinMessageWorkspaceEntity;
    const { listener, upsertTimelineActivities } = setup({
      participants: [
        {
          isSelf: false,
          linkedinUrn: 'urn:li:person:sender',
          personId: PERSON_ID,
          threadId: 'thread-id',
        } as LinkedinThreadParticipantWorkspaceEntity,
        {
          isSelf: false,
          linkedinUrn: 'urn:li:person:other',
          personId: 'other-person-id',
          threadId: 'thread-id',
        } as LinkedinThreadParticipantWorkspaceEntity,
      ],
    });

    await listener.handleMessageCreatedEvent(
      buildPayload('linkedinMessage', [
        {
          recordId: message.id,
          properties: { after: message },
        } as ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            name: 'linkedin.message-received',
            recordId: PERSON_ID,
          }),
        ],
      }),
    );
  });

  it('does not guess a sender when multiple people match the same LinkedIn identity', async () => {
    const message = {
      deliveredAt: new Date('2026-08-13T09:05:00.000Z'),
      direction: 'INBOUND',
      id: 'message-id',
      ownerWorkspaceMemberId: 'workspace-member-id',
      senderLinkedinUrn: 'urn:li:person:sender',
      threadId: 'thread-id',
    } as LinkedinMessageWorkspaceEntity;
    const { listener, upsertTimelineActivities } = setup({
      participants: [
        {
          isSelf: false,
          linkedinUrn: 'urn:li:person:sender',
          personId: PERSON_ID,
          threadId: 'thread-id',
        } as LinkedinThreadParticipantWorkspaceEntity,
        {
          isSelf: false,
          linkedinUrn: 'urn:li:person:sender',
          personId: 'ambiguous-person-id',
          threadId: 'thread-id',
        } as LinkedinThreadParticipantWorkspaceEntity,
      ],
    });

    await listener.handleMessageCreatedEvent(
      buildPayload('linkedinMessage', [
        {
          recordId: message.id,
          properties: { after: message },
        } as ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).not.toHaveBeenCalled();
  });

  it('does not duplicate an outbound synced message already represented by its action', async () => {
    const { listener, upsertTimelineActivities } = setup({
      participants: [
        {
          isSelf: false,
          personId: PERSON_ID,
          threadId: 'thread-id',
        } as LinkedinThreadParticipantWorkspaceEntity,
      ],
    });
    const message = {
      deliveredAt: new Date('2026-08-13T09:05:00.000Z'),
      direction: 'OUTBOUND',
      id: 'message-id',
      ownerWorkspaceMemberId: 'workspace-member-id',
      threadId: 'thread-id',
    } as LinkedinMessageWorkspaceEntity;

    await listener.handleMessageCreatedEvent(
      buildPayload('linkedinMessage', [
        {
          recordId: message.id,
          properties: { after: message },
        } as ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).not.toHaveBeenCalled();
  });

  it('backfills messages when a participant is linked to a person later', async () => {
    const message = {
      deliveredAt: new Date('2026-08-13T09:05:00.000Z'),
      direction: 'INBOUND',
      id: 'message-id',
      ownerWorkspaceMemberId: 'workspace-member-id',
      senderLinkedinUrn: null,
      threadId: 'thread-id',
    } as LinkedinMessageWorkspaceEntity;
    const participantAfter = {
      isSelf: false,
      personId: PERSON_ID,
      threadId: 'thread-id',
    } as LinkedinThreadParticipantWorkspaceEntity;
    const { listener, upsertTimelineActivities } = setup({
      messages: [message],
      participants: [participantAfter],
    });

    await listener.handleParticipantUpdatedEvent(
      buildPayload('linkedinThreadParticipant', [
        {
          recordId: 'participant-id',
          properties: {
            before: { ...participantAfter, personId: null },
            after: participantAfter,
          },
        } as ObjectRecordUpdateEvent<LinkedinThreadParticipantWorkspaceEntity>,
      ]),
    );

    expect(upsertTimelineActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        payloads: [expect.objectContaining({ recordId: PERSON_ID })],
      }),
    );
  });
});
