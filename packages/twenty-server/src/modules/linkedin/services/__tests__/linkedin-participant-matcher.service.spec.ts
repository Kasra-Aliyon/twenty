import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinParticipantMatcherService } from 'src/modules/linkedin/services/linkedin-participant-matcher.service';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { type LinkedinMessageThreadWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message-thread.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '20202020-2222-4222-8222-222222222222';
const THREAD_ID = '20202020-3333-4333-8333-333333333333';
const PERSON_ID = '20202020-4444-4444-8444-444444444444';
const OTHER_PERSON_ID = '20202020-5555-4555-8555-555555555555';
const OWNER_LINKEDIN_ID = 'owner-linkedin-id';
const LINKEDIN_URN = 'ACoAABparticipant';

describe('LinkedinParticipantMatcherService', () => {
  const participantRepository = {
    find: jest.fn(),
    updateMany: jest.fn(),
  };
  const threadRepository = {
    find: jest.fn(),
  };
  const connectionRepository = {
    find: jest.fn(),
  };
  const personNameQueryBuilder = {
    select: jest.fn(),
    where: jest.fn(),
    getMany: jest.fn(),
  };
  const personRepository = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => Promise<void>) =>
      callback(),
    ),
    getRepository: jest.fn(
      async (_workspaceId: string, objectMetadataName: string) => {
        switch (objectMetadataName) {
          case 'linkedinConnection':
            return connectionRepository;
          case 'linkedinThreadParticipant':
            return participantRepository;
          case 'linkedinMessageThread':
            return threadRepository;
          case 'person':
            return personRepository;
          default:
            throw new Error(`Unexpected repository ${objectMetadataName}`);
        }
      },
    ),
  };
  const service = new LinkedinParticipantMatcherService(
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
  );

  const buildParticipant = (
    overrides: Partial<LinkedinThreadParticipantWorkspaceEntity> = {},
  ): LinkedinThreadParticipantWorkspaceEntity =>
    ({
      id: PARTICIPANT_ID,
      handle: 'ada-lovelace',
      isSelf: false,
      linkedinUrn: LINKEDIN_URN,
      name: 'Ada Lovelace',
      personId: null,
      threadId: THREAD_ID,
      ...overrides,
    }) as LinkedinThreadParticipantWorkspaceEntity;

  const buildPerson = (
    overrides: Partial<PersonWorkspaceEntity> = {},
  ): PersonWorkspaceEntity =>
    ({
      id: PERSON_ID,
      linkedinLink: null,
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      ...overrides,
    }) as PersonWorkspaceEntity;

  const buildConnection = (
    overrides: Partial<LinkedinConnectionWorkspaceEntity> = {},
  ): LinkedinConnectionWorkspaceEntity =>
    ({
      handle: 'ada-lovelace',
      linkedinUrn: LINKEDIN_URN,
      ownerLinkedinId: OWNER_LINKEDIN_ID,
      ...overrides,
    }) as LinkedinConnectionWorkspaceEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    participantRepository.find.mockResolvedValue([buildParticipant()]);
    participantRepository.updateMany.mockResolvedValue([]);
    threadRepository.find.mockResolvedValue([
      {
        id: THREAD_ID,
        ownerLinkedinId: OWNER_LINKEDIN_ID,
      } as LinkedinMessageThreadWorkspaceEntity,
    ]);
    connectionRepository.find.mockResolvedValue([]);
    personRepository.find.mockResolvedValue([]);
    personNameQueryBuilder.select.mockReturnValue(personNameQueryBuilder);
    personNameQueryBuilder.where.mockReturnValue(personNameQueryBuilder);
    personNameQueryBuilder.getMany.mockResolvedValue([]);
    personRepository.createQueryBuilder.mockReturnValue(personNameQueryBuilder);
  });

  it('matches a normalized participant handle to a Person LinkedIn URL', async () => {
    participantRepository.find.mockResolvedValue([
      buildParticipant({
        handle: 'https://www.linkedin.com/in/Ada-Lovelace/?trk=profile',
      }),
    ]);
    personRepository.find.mockResolvedValue([
      buildPerson({
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace/',
          secondaryLinks: null,
        },
      }),
    ]);

    await service.matchParticipantsByIds({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(participantRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PARTICIPANT_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });

  it('falls back through the same-owner connection handle', async () => {
    participantRepository.find.mockResolvedValue([
      buildParticipant({ handle: null }),
    ]);
    connectionRepository.find.mockResolvedValue([buildConnection()]);
    personRepository.find.mockResolvedValue([
      buildPerson({
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
          secondaryLinks: null,
        },
      }),
    ]);

    await service.matchParticipantsByIds({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          {
            linkedinUrn: LINKEDIN_URN,
            ownerLinkedinId: OWNER_LINKEDIN_ID,
          },
        ],
      }),
    );
    expect(participantRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PARTICIPANT_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });

  it('uses an exact full name only when it resolves to one Person', async () => {
    participantRepository.find.mockResolvedValue([
      buildParticipant({ handle: null, linkedinUrn: null }),
    ]);
    personNameQueryBuilder.getMany.mockResolvedValue([buildPerson()]);

    await service.matchParticipantsByIds({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(participantRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PARTICIPANT_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });

  it('does not guess when an exact full name is ambiguous', async () => {
    participantRepository.find.mockResolvedValue([
      buildParticipant({ handle: null, linkedinUrn: null }),
    ]);
    personNameQueryBuilder.getMany.mockResolvedValue([
      buildPerson(),
      buildPerson({ id: OTHER_PERSON_ID }),
    ]);

    await service.matchParticipantsByIds({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(participantRepository.updateMany).not.toHaveBeenCalled();
  });

  it('never uses a connection belonging to another LinkedIn owner', async () => {
    participantRepository.find.mockResolvedValue([
      buildParticipant({ handle: null }),
    ]);
    connectionRepository.find.mockResolvedValue([
      buildConnection({
        handle: 'wrong-owner',
        ownerLinkedinId: 'another-owner',
      }),
      buildConnection({ handle: 'right-owner' }),
    ]);
    personRepository.find.mockResolvedValue([
      buildPerson({
        id: OTHER_PERSON_ID,
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/wrong-owner',
          secondaryLinks: null,
        },
      }),
      buildPerson({
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/right-owner',
          secondaryLinks: null,
        },
      }),
    ]);

    await service.matchParticipantsByIds({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(participantRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PARTICIPANT_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });

  it('clears an accidental Person link for the LinkedIn account owner', async () => {
    participantRepository.find.mockResolvedValue([
      buildParticipant({ isSelf: true, personId: PERSON_ID }),
    ]);

    await service.matchParticipantsByIds({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(personRepository.find).not.toHaveBeenCalled();
    expect(personRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(participantRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PARTICIPANT_ID,
        partialEntity: { personId: null },
      },
    ]);
  });

  it('back-links historical participants when a matching Person changes', async () => {
    const person = buildPerson({
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
        secondaryLinks: null,
      },
    });

    personRepository.find
      .mockResolvedValueOnce([person])
      .mockResolvedValueOnce([person]);
    connectionRepository.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.matchParticipantsForPeople({
      personIds: [PERSON_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(participantRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({ personId: expect.anything() }),
        ]),
      }),
    );
    expect(participantRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PARTICIPANT_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });
});
