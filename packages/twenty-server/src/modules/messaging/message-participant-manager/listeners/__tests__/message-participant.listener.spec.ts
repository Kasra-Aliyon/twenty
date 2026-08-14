import { MessageParticipantRole } from 'twenty-shared/types';

import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { type ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { MessageParticipantListener } from 'src/modules/messaging/message-participant-manager/listeners/message-participant.listener';
import { type TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';

describe('MessageParticipantListener', () => {
  const setup = ({
    associations = [],
    messages = [],
  }: {
    associations?: Array<{ direction: MessageDirection; messageId: string }>;
    messages?: Array<{ id: string; receivedAt: Date | null }>;
  } = {}) => {
    const associationFind = jest.fn().mockResolvedValue(associations);
    const messageFind = jest.fn().mockResolvedValue(messages);
    const upsertTimelineActivities = jest.fn();
    const findOneOrFail = jest
      .fn()
      .mockResolvedValue({ id: 'message-metadata-id' });
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<unknown>) => callback(),
      ),
      getRepository: jest.fn(async (_workspaceId: string, entity: unknown) => {
        if (entity === MessageChannelMessageAssociationWorkspaceEntity) {
          return { find: associationFind };
        }

        if (entity === MessageWorkspaceEntity) {
          return { find: messageFind };
        }

        throw new Error('Unexpected repository');
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const listener = new MessageParticipantListener(
      { upsertTimelineActivities } as unknown as TimelineActivityRepository,
      {
        findOneOrFail,
      } as unknown as import('typeorm').Repository<ObjectMetadataEntity>,
      {} as FeatureFlagService,
      globalWorkspaceOrmManager,
    );

    return {
      associationFind,
      findOneOrFail,
      globalWorkspaceOrmManager,
      listener,
      messageFind,
      upsertTimelineActivities,
    };
  };

  const participant = ({
    messageId,
    personId,
    role = MessageParticipantRole.FROM,
  }: {
    messageId: string;
    personId: string | null;
    role?: MessageParticipantRole;
  }) =>
    ({
      messageId,
      personId,
      role,
    }) as MessageParticipantWorkspaceEntity;

  it('records sent and received emails at the message time', async () => {
    const incomingAt = new Date('2026-08-13T09:00:00.000Z');
    const outgoingAt = new Date('2026-08-13T09:05:00.000Z');
    const { listener, upsertTimelineActivities } = setup({
      associations: [
        {
          direction: MessageDirection.INCOMING,
          messageId: 'incoming-message-id',
        },
        {
          direction: MessageDirection.OUTGOING,
          messageId: 'outgoing-message-id',
        },
      ],
      messages: [
        { id: 'incoming-message-id', receivedAt: incomingAt },
        { id: 'outgoing-message-id', receivedAt: outgoingAt },
      ],
    });

    await listener.handleMessageParticipantMatched({
      events: [
        {
          participants: [
            participant({
              messageId: 'incoming-message-id',
              personId: 'incoming-person-id',
            }),
            participant({
              messageId: 'incoming-message-id',
              personId: 'incoming-recipient-person-id',
              role: MessageParticipantRole.TO,
            }),
          ],
          workspaceMemberId: 'workspace-member-id',
        },
        {
          participants: [
            participant({
              messageId: 'outgoing-message-id',
              personId: 'outgoing-person-id',
              role: MessageParticipantRole.TO,
            }),
            participant({
              messageId: 'outgoing-message-id',
              personId: 'outgoing-sender-person-id',
            }),
          ],
          workspaceMemberId: 'workspace-member-id',
        },
      ],
      name: 'messageParticipant_matched',
      workspaceId: WORKSPACE_ID,
    });

    expect(upsertTimelineActivities).toHaveBeenCalledWith({
      objectSingularName: 'person',
      payloads: [
        expect.objectContaining({
          happensAt: incomingAt,
          linkedRecordId: 'incoming-message-id',
          name: 'message.received',
          recordId: 'incoming-person-id',
        }),
        expect.objectContaining({
          happensAt: outgoingAt,
          linkedRecordId: 'outgoing-message-id',
          name: 'message.sent',
          recordId: 'outgoing-person-id',
        }),
      ],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('keeps the generic email activity when direction is unavailable', async () => {
    const { listener, upsertTimelineActivities } = setup();

    await listener.handleMessageParticipantMatched({
      events: [
        {
          participants: [
            participant({ messageId: 'message-id', personId: 'person-id' }),
          ],
          workspaceMemberId: 'workspace-member-id',
        },
      ],
      name: 'messageParticipant_matched',
      workspaceId: WORKSPACE_ID,
    });

    expect(upsertTimelineActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            happensAt: undefined,
            name: 'message.linked',
          }),
        ],
      }),
    );
  });

  it('does not query message data when no participant is linked to a person', async () => {
    const {
      findOneOrFail,
      globalWorkspaceOrmManager,
      listener,
      upsertTimelineActivities,
    } = setup();

    await listener.handleMessageParticipantMatched({
      events: [
        {
          participants: [
            participant({ messageId: 'message-id', personId: null }),
          ],
          workspaceMemberId: 'workspace-member-id',
        },
      ],
      name: 'messageParticipant_matched',
      workspaceId: WORKSPACE_ID,
    });

    expect(
      globalWorkspaceOrmManager.executeInWorkspaceContext,
    ).not.toHaveBeenCalled();
    expect(findOneOrFail).not.toHaveBeenCalled();
    expect(upsertTimelineActivities).not.toHaveBeenCalled();
  });
});
