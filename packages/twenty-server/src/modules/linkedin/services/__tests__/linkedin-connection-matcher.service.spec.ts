import { LINKEDIN_CONNECTION_STATES } from 'twenty-shared/types';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinConnectionMatcherService } from 'src/modules/linkedin/services/linkedin-connection-matcher.service';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const CONNECTION_ID = '20202020-2222-4222-8222-222222222222';
const PERSON_ID = '20202020-4444-4444-8444-444444444444';
const OTHER_PERSON_ID = '20202020-5555-4555-8555-555555555555';

describe('LinkedinConnectionMatcherService', () => {
  const connectionRepository = {
    find: jest.fn(),
    updateMany: jest.fn(),
  };
  const personNameQueryBuilder = {
    select: jest.fn(),
    where: jest.fn(),
    getMany: jest.fn(),
  };
  const personRepository = {
    find: jest.fn(),
    update: jest.fn(),
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
          case 'person':
            return personRepository;
          default:
            throw new Error(`Unexpected repository ${objectMetadataName}`);
        }
      },
    ),
  };
  const service = new LinkedinConnectionMatcherService(
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
  );

  const buildConnection = (
    overrides: Partial<LinkedinConnectionWorkspaceEntity> = {},
  ): LinkedinConnectionWorkspaceEntity =>
    ({
      id: CONNECTION_ID,
      handle: 'ada-lovelace',
      name: 'Ada Lovelace',
      personId: null,
      ...overrides,
    }) as LinkedinConnectionWorkspaceEntity;

  const buildPerson = (
    overrides: Partial<PersonWorkspaceEntity> = {},
  ): PersonWorkspaceEntity =>
    ({
      id: PERSON_ID,
      linkedinLink: null,
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      ...overrides,
    }) as PersonWorkspaceEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    connectionRepository.find.mockResolvedValue([buildConnection()]);
    connectionRepository.updateMany.mockResolvedValue([]);
    personRepository.find.mockResolvedValue([]);
    personRepository.update.mockResolvedValue({ affected: 1 });
    personNameQueryBuilder.select.mockReturnValue(personNameQueryBuilder);
    personNameQueryBuilder.where.mockReturnValue(personNameQueryBuilder);
    personNameQueryBuilder.getMany.mockResolvedValue([]);
    personRepository.createQueryBuilder.mockReturnValue(personNameQueryBuilder);
  });

  it('matches a normalized connection handle to a Person LinkedIn URL and marks them connected', async () => {
    connectionRepository.find.mockResolvedValue([
      buildConnection({
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

    await service.matchConnectionsByIds({
      connectionIds: [CONNECTION_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: CONNECTION_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
    expect(personRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() }),
      { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED },
    );
  });

  it('does not guess when a handle is ambiguous across People', async () => {
    personRepository.find.mockResolvedValue([
      buildPerson({
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
          secondaryLinks: null,
        },
      }),
      buildPerson({
        id: OTHER_PERSON_ID,
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
          secondaryLinks: null,
        },
      }),
    ]);

    await service.matchConnectionsByIds({
      connectionIds: [CONNECTION_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.updateMany).not.toHaveBeenCalled();
    expect(personRepository.update).not.toHaveBeenCalled();
  });

  it('falls back to an exact full name only when it resolves to one Person', async () => {
    connectionRepository.find.mockResolvedValue([
      buildConnection({ handle: '' }),
    ]);
    personNameQueryBuilder.getMany.mockResolvedValue([buildPerson()]);

    await service.matchConnectionsByIds({
      connectionIds: [CONNECTION_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: CONNECTION_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });

  it('does not guess when an exact full name is ambiguous', async () => {
    connectionRepository.find.mockResolvedValue([
      buildConnection({ handle: '' }),
    ]);
    personNameQueryBuilder.getMany.mockResolvedValue([
      buildPerson(),
      buildPerson({ id: OTHER_PERSON_ID }),
    ]);

    await service.matchConnectionsByIds({
      connectionIds: [CONNECTION_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.updateMany).not.toHaveBeenCalled();
  });

  it('repairs connection state when the resolved Person link is unchanged', async () => {
    connectionRepository.find.mockResolvedValue([
      buildConnection({ personId: PERSON_ID }),
    ]);
    personRepository.find.mockResolvedValue([
      buildPerson({
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
          secondaryLinks: null,
        },
      }),
    ]);

    await service.matchConnectionsByIds({
      connectionIds: [CONNECTION_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.updateMany).not.toHaveBeenCalled();
    expect(personRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() }),
      { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED },
    );
  });

  it('back-links historical connections when a matching Person changes', async () => {
    const person = buildPerson({
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://linkedin.com/in/ada-lovelace',
        secondaryLinks: null,
      },
    });

    personRepository.find.mockResolvedValue([person]);

    await service.matchConnectionsForPeople({
      personIds: [PERSON_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({ personId: expect.anything() }),
        ]),
      }),
    );
    expect(connectionRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: CONNECTION_ID,
        partialEntity: { personId: PERSON_ID },
      },
    ]);
  });
});
