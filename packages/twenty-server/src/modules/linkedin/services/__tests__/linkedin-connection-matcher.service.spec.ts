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
    updateMany: jest.fn(),
    createQueryBuilder: jest.fn(),
    metadata: {
      findColumnWithPropertyPath: jest.fn(),
    },
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
      connectedAt: new Date('2025-03-04T12:30:00.000Z'),
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
    personRepository.updateMany.mockResolvedValue({ raw: [] });
    personRepository.metadata.findColumnWithPropertyPath.mockReturnValue({});
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
    expect(personRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PERSON_ID,
        partialEntity: {
          linkedinConnectedAt: new Date('2025-03-04T12:30:00.000Z'),
          linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      },
    ]);
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
    expect(personRepository.updateMany).not.toHaveBeenCalled();
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
    expect(personRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PERSON_ID,
        partialEntity: {
          linkedinConnectedAt: new Date('2025-03-04T12:30:00.000Z'),
          linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      },
    ]);
  });

  it('marks the Person connected before the connection date field is available', async () => {
    personRepository.metadata.findColumnWithPropertyPath.mockReturnValue(
      undefined,
    );
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

    expect(personRepository.find).toHaveBeenCalledTimes(1);
    expect(personRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PERSON_ID,
        partialEntity: {
          linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      },
    ]);
  });

  it('preserves a stored Person match and backfills its connection date', async () => {
    connectionRepository.find.mockResolvedValue([
      buildConnection({
        handle: '',
        name: '',
        personId: PERSON_ID,
      }),
    ]);

    await service.matchConnectionsByIds({
      connectionIds: [CONNECTION_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(connectionRepository.updateMany).not.toHaveBeenCalled();
    expect(personRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PERSON_ID,
        partialEntity: {
          linkedinConnectedAt: new Date('2025-03-04T12:30:00.000Z'),
          linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      },
    ]);
  });

  it('keeps the most recent connection date for a Person', async () => {
    const olderConnectionDate = new Date('2024-01-02T10:00:00.000Z');
    const newerConnectionDate = new Date('2025-06-07T11:00:00.000Z');

    connectionRepository.find.mockResolvedValue([
      buildConnection({ connectedAt: olderConnectionDate }),
      buildConnection({
        id: '20202020-3333-4333-8333-333333333333',
        connectedAt: newerConnectionDate,
      }),
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

    expect(personRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PERSON_ID,
        partialEntity: {
          linkedinConnectedAt: newerConnectionDate,
          linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      },
    ]);
  });

  it('does not replace a newer connection date already stored on the Person', async () => {
    const storedConnectionDate = new Date('2026-01-02T10:00:00.000Z');

    personRepository.find.mockResolvedValue([
      buildPerson({
        linkedinConnectedAt: storedConnectionDate,
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

    expect(personRepository.updateMany).toHaveBeenCalledWith([
      {
        criteria: PERSON_ID,
        partialEntity: {
          linkedinConnectedAt: storedConnectionDate,
          linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      },
    ]);
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
