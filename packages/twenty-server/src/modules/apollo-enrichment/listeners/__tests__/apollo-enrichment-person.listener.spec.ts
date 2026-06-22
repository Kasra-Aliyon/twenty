import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import { FieldActorSource } from 'twenty-shared/types';

import { ApolloEnrichmentPersonListener } from 'src/modules/apollo-enrichment/listeners/apollo-enrichment-person.listener';
import { ApolloEnrichmentMapperService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { type ApolloEnrichmentQueueService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-queue.service';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

describe('ApolloEnrichmentPersonListener', () => {
  const buildPerson = (
    overrides: Partial<PersonWorkspaceEntity> = {},
  ): PersonWorkspaceEntity =>
    ({
      id: 'person-id',
      name: {
        firstName: '',
        lastName: '',
      },
      emails: {
        primaryEmail: '',
        additionalEmails: null,
      },
      phones: {
        primaryPhoneNumber: '',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
      linkedinLink: null,
      companyId: null,
      ...overrides,
    }) as PersonWorkspaceEntity;

  const enqueuePerson = jest.fn();
  const listener = new ApolloEnrichmentPersonListener(
    new ApolloEnrichmentMapperService(),
    {
      enqueuePerson,
    } as unknown as ApolloEnrichmentQueueService,
  );

  beforeEach(() => {
    enqueuePerson.mockReset();
  });

  const buildEventBatch = <T>(events: T[]): WorkspaceEventBatch<T> => ({
    name: 'person',
    workspaceId: 'workspace-id',
    objectMetadata: {} as FlatObjectMetadata,
    events,
  });

  it('enqueues created people that need enrichment', async () => {
    const person = buildPerson({
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/in/jane',
        secondaryLinks: null,
      },
    });

    await listener.handleCreatedEvent(
      buildEventBatch([
        {
          recordId: 'person-id',
          properties: {
            after: person,
          },
        } as ObjectRecordCreateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(enqueuePerson).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      personId: 'person-id',
      trigger: 'person.created',
    });
  });

  it('enqueues when an existing person gets a LinkedIn URL', async () => {
    await listener.handleUpdatedEvent(
      buildEventBatch([
        {
          recordId: 'person-id',
          properties: {
            before: buildPerson(),
            after: buildPerson({
              linkedinLink: {
                primaryLinkLabel: '',
                primaryLinkUrl: 'https://www.linkedin.com/in/jane',
                secondaryLinks: null,
              },
            }),
          },
        } as ObjectRecordUpdateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(enqueuePerson).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      personId: 'person-id',
      trigger: 'person.updated',
    });
  });

  it('enqueues when a soft-deleted person is restored', async () => {
    const restoredPerson = buildPerson({
      deletedAt: null,
      emails: {
        primaryEmail: 'stale@example.com',
        additionalEmails: null,
      },
      phones: {
        primaryPhoneNumber: '+14155550100',
        primaryPhoneCountryCode: 'US',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
      companyId: 'company-id',
      createdBy: {
        source: FieldActorSource.API,
        workspaceMemberId: null,
        name: 'API',
        context: {},
      },
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/in/jane',
        secondaryLinks: null,
      },
    });

    await listener.handleUpdatedEvent(
      buildEventBatch([
        {
          recordId: 'person-id',
          properties: {
            before: {
              ...restoredPerson,
              deletedAt: '2026-06-22T07:00:00.000Z',
            },
            after: restoredPerson,
          },
        } as ObjectRecordUpdateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(enqueuePerson).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      personId: 'person-id',
      trigger: 'person.updated',
    });
  });

  it('does not enqueue for email-only updates', async () => {
    await listener.handleUpdatedEvent(
      buildEventBatch([
        {
          recordId: 'person-id',
          properties: {
            before: buildPerson(),
            after: buildPerson({
              emails: {
                primaryEmail: 'apollo@example.com',
                additionalEmails: null,
              },
            }),
          },
        } as ObjectRecordUpdateEvent<PersonWorkspaceEntity>,
      ]),
    );

    expect(enqueuePerson).not.toHaveBeenCalled();
  });
});
