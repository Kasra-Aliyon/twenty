import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinConnectionMatchJob } from 'src/modules/linkedin/jobs/linkedin-connection-match.job';
import { LinkedinConnectionListener } from 'src/modules/linkedin/listeners/linkedin-connection.listener';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const CONNECTION_ID = '20202020-2222-4222-8222-222222222222';

describe('LinkedIn connection listener', () => {
  const add = jest.fn();
  const messageQueueService = { add } as unknown as MessageQueueService;
  const listener = new LinkedinConnectionListener(messageQueueService);

  const buildEventBatch = <T>(events: T[]): WorkspaceEventBatch<T> => ({
    events,
    name: 'linkedinConnection',
    objectMetadata: {} as FlatObjectMetadata,
    workspaceId: WORKSPACE_ID,
  });

  beforeEach(() => {
    add.mockReset();
  });

  it('queues every newly created connection for matching', async () => {
    await listener.handleCreatedEvent(
      buildEventBatch([
        {
          recordId: CONNECTION_ID,
          properties: {
            after: { id: CONNECTION_ID, handle: 'ada-lovelace' },
          },
        } as ObjectRecordCreateEvent<LinkedinConnectionWorkspaceEntity>,
      ]),
    );

    expect(add).toHaveBeenCalledWith(LinkedinConnectionMatchJob.name, {
      connectionIds: [CONNECTION_ID],
      personIds: [],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('rematches a connection when a later sync changes its identity', async () => {
    const connectionBefore = {
      id: CONNECTION_ID,
      handle: '',
      headline: 'Mathematician',
      name: 'Ada Lovelace',
    } as LinkedinConnectionWorkspaceEntity;

    await listener.handleUpdatedEvent(
      buildEventBatch([
        {
          recordId: CONNECTION_ID,
          properties: {
            before: connectionBefore,
            after: { ...connectionBefore, handle: 'ada-lovelace' },
          },
        } as ObjectRecordUpdateEvent<LinkedinConnectionWorkspaceEntity>,
      ]),
    );

    expect(add).toHaveBeenCalledWith(LinkedinConnectionMatchJob.name, {
      connectionIds: [CONNECTION_ID],
      personIds: [],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('does not rematch a connection for non-identity updates', async () => {
    const connectionBefore = {
      id: CONNECTION_ID,
      handle: 'ada-lovelace',
      headline: 'Mathematician',
      name: 'Ada Lovelace',
    } as LinkedinConnectionWorkspaceEntity;

    await listener.handleUpdatedEvent(
      buildEventBatch([
        {
          recordId: CONNECTION_ID,
          properties: {
            before: connectionBefore,
            after: { ...connectionBefore, headline: 'Programmer' },
          },
        } as ObjectRecordUpdateEvent<LinkedinConnectionWorkspaceEntity>,
      ]),
    );

    expect(add).not.toHaveBeenCalled();
  });
});
