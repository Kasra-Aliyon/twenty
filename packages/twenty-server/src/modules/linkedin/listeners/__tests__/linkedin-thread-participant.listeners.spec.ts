import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinThreadParticipantMatchJob } from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
import { LinkedinThreadParticipantPersonListener } from 'src/modules/linkedin/listeners/linkedin-thread-participant-person.listener';
import { LinkedinThreadParticipantListener } from 'src/modules/linkedin/listeners/linkedin-thread-participant.listener';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '20202020-2222-4222-8222-222222222222';
const PERSON_ID = '20202020-3333-4333-8333-333333333333';

describe('LinkedIn thread participant listeners', () => {
  const add = jest.fn();
  const messageQueueService = { add } as unknown as MessageQueueService;
  const participantListener = new LinkedinThreadParticipantListener(
    messageQueueService,
  );
  const personListener = new LinkedinThreadParticipantPersonListener(
    messageQueueService,
  );

  const buildEventBatch = <T>(
    name: string,
    events: T[],
  ): WorkspaceEventBatch<T> => ({
    events,
    name,
    objectMetadata: {} as FlatObjectMetadata,
    workspaceId: WORKSPACE_ID,
  });

  beforeEach(() => {
    add.mockReset();
  });

  it('queues every newly created LinkedIn participant for matching', async () => {
    await participantListener.handleCreatedEvent(
      buildEventBatch('linkedinThreadParticipant', [
        {
          recordId: PARTICIPANT_ID,
          properties: {
            after: { id: PARTICIPANT_ID, isSelf: false },
          },
        } as ObjectRecordCreateEvent<LinkedinThreadParticipantWorkspaceEntity>,
      ]),
    );

    expect(add).toHaveBeenCalledWith(LinkedinThreadParticipantMatchJob.name, {
      participantIds: [PARTICIPANT_ID],
      personIds: [],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('queues created people so historical participants are back-linked', async () => {
    await personListener.handleCreatedEvent(
      buildEventBatch('person', [
        {
          recordId: PERSON_ID,
          properties: { after: { id: PERSON_ID } },
        } as ObjectRecordCreateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(add).toHaveBeenCalledWith(LinkedinThreadParticipantMatchJob.name, {
      participantIds: [],
      personIds: [PERSON_ID],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('queues only Person updates that can change LinkedIn matching', async () => {
    const personBefore = {
      id: PERSON_ID,
      jobTitle: 'Mathematician',
      linkedinLink: null,
      name: { firstName: 'Ada', lastName: 'Lovelace' },
    } as PersonWorkspaceEntity;

    await personListener.handleUpdatedEvent(
      buildEventBatch('person', [
        {
          recordId: PERSON_ID,
          properties: {
            before: personBefore,
            after: { ...personBefore, jobTitle: 'Programmer' },
          },
        } as ObjectRecordUpdateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(add).not.toHaveBeenCalled();

    await personListener.handleUpdatedEvent(
      buildEventBatch('person', [
        {
          recordId: PERSON_ID,
          properties: {
            before: personBefore,
            after: {
              ...personBefore,
              linkedinLink: {
                primaryLinkLabel: '',
                primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
                secondaryLinks: null,
              },
            },
          },
        } as ObjectRecordUpdateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(add).toHaveBeenCalledWith(LinkedinThreadParticipantMatchJob.name, {
      participantIds: [],
      personIds: [PERSON_ID],
      workspaceId: WORKSPACE_ID,
    });
  });
});
