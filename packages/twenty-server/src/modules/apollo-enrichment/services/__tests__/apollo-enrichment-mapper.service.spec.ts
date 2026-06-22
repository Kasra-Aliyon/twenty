import { FieldActorSource } from 'twenty-shared/types';

import { ApolloEnrichmentMapperService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { type ApolloPerson } from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

describe('ApolloEnrichmentMapperService', () => {
  const mapper = new ApolloEnrichmentMapperService();

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
      jobTitle: null,
      companyId: null,
      ...overrides,
    }) as PersonWorkspaceEntity;

  it('cleans LinkedIn URLs', () => {
    expect(
      mapper.cleanLinkedinUrl(
        'https://www.linkedin.com/in/jane-doe/?miniProfileUrn=123#about',
      ),
    ).toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('maps Apollo person data into empty Twenty person fields', () => {
    const person = buildPerson();
    const apolloPerson: ApolloPerson = {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'Jane.Doe@Example.com',
      title: 'VP Sales',
      linkedin_url: 'linkedin.com/in/jane-doe?trk=public-profile',
      phone_numbers: [
        {
          raw_number: '+14155550100',
        },
      ],
    };

    const update = mapper.mapApolloPersonToTwentyUpdate({
      person,
      apolloPerson,
      companyId: 'company-id',
    });

    expect(update).toEqual({
      name: {
        firstName: 'Jane',
        lastName: 'Doe',
      },
      emails: {
        primaryEmail: 'jane.doe@example.com',
        additionalEmails: null,
      },
      phones: {
        primaryPhoneNumber: '+14155550100',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://linkedin.com/in/jane-doe',
        secondaryLinks: null,
      },
      jobTitle: 'VP Sales',
      companyId: 'company-id',
    });
    expect(update).not.toHaveProperty('city');
  });

  it('does not overwrite populated Twenty fields', () => {
    const person = buildPerson({
      name: {
        firstName: 'Existing',
        lastName: 'Name',
      },
      emails: {
        primaryEmail: 'existing@example.com',
        additionalEmails: null,
      },
      phones: {
        primaryPhoneNumber: '123',
        primaryPhoneCountryCode: 'US',
        primaryPhoneCallingCode: '+1',
        additionalPhones: null,
      },
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/in/existing',
        secondaryLinks: null,
      },
      jobTitle: 'Existing title',
      companyId: 'existing-company-id',
    });
    const update = mapper.mapApolloPersonToTwentyUpdate({
      person,
      apolloPerson: {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        sanitized_phone: '+14155550100',
        title: 'VP Sales',
        linkedin_url: 'https://www.linkedin.com/in/jane',
      },
      companyId: 'new-company-id',
    });

    expect(update).toEqual({});
  });

  it('refreshes existing primary email for auto-created contact records', () => {
    const person = buildPerson({
      emails: {
        primaryEmail: 'stale@example.com',
        additionalEmails: ['alias@example.com'],
      },
      createdBy: {
        source: FieldActorSource.EMAIL,
        workspaceMemberId: null,
        name: 'System',
        context: {},
      },
    });
    const update = mapper.mapApolloPersonToTwentyUpdate({
      person,
      apolloPerson: {
        email: 'fresh@example.com',
      },
    });

    expect(update).toEqual({
      emails: {
        primaryEmail: 'fresh@example.com',
        additionalEmails: ['alias@example.com'],
      },
    });
  });

  it('keeps existing primary email for manual contact records', () => {
    const person = buildPerson({
      emails: {
        primaryEmail: 'manual@example.com',
        additionalEmails: null,
      },
      createdBy: {
        source: FieldActorSource.MANUAL,
        workspaceMemberId: null,
        name: 'Manual User',
        context: {},
      },
    });
    const update = mapper.mapApolloPersonToTwentyUpdate({
      person,
      apolloPerson: {
        email: 'apollo@example.com',
      },
    });

    expect(update).toEqual({});
  });

  it('considers auto-created contact records with stale emails enrichable', () => {
    expect(
      mapper.shouldEnrichPerson(
        buildPerson({
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
            source: FieldActorSource.CALENDAR,
            workspaceMemberId: null,
            name: 'System',
            context: {},
          },
        }),
      ),
    ).toBe(true);
  });

  it('considers API-created contact records with stale emails enrichable', () => {
    expect(
      mapper.shouldEnrichPerson(
        buildPerson({
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
        }),
      ),
    ).toBe(true);
  });

  it('normalizes Apollo organization domains and links', () => {
    const mappedCompany = mapper.mapApolloOrganization({
      name: 'Acme',
      website_url: 'https://www.acme.com/about',
      linkedin_url: 'https://www.linkedin.com/company/acme/?trk=foo',
      estimated_num_employees: '42',
    });

    expect(mappedCompany).toEqual({
      name: 'Acme',
      domain: 'acme.com',
      domainName: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://acme.com',
        secondaryLinks: null,
      },
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/company/acme',
        secondaryLinks: null,
      },
      employees: 42,
    });
  });

  it('only triggers updates on new identity input', () => {
    const before = buildPerson();
    const after = buildPerson({
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/in/jane',
        secondaryLinks: null,
      },
    });

    expect(
      mapper.shouldEnrichAfterUpdate({
        before,
        after,
        changedFields: ['linkedinLink'],
      }),
    ).toBe(true);
    expect(
      mapper.shouldEnrichAfterUpdate({
        before,
        after: buildPerson({
          emails: {
            primaryEmail: 'apollo@example.com',
            additionalEmails: null,
          },
        }),
        changedFields: ['emails'],
      }),
    ).toBe(false);
    expect(
      mapper.shouldEnrichAfterUpdate({
        before,
        after: buildPerson({
          name: {
            firstName: 'Jane',
            lastName: 'Doe',
          },
        }),
        changedFields: ['name'],
      }),
    ).toBe(false);
  });

  it('triggers enrichment when a soft-deleted person is restored', () => {
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

    expect(
      mapper.shouldEnrichAfterUpdate({
        before: {
          ...restoredPerson,
          deletedAt: '2026-06-22T07:00:00.000Z',
        },
        after: restoredPerson,
        changedFields: ['deletedAt'],
      }),
    ).toBe(true);
  });
});
