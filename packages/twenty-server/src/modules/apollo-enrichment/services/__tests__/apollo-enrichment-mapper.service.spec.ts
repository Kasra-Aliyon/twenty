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

  it('uses all available identifiers for Apollo person matching', () => {
    const input = mapper.buildPersonMatchInput(
      buildPerson({
        name: {
          firstName: 'Jane',
          lastName: 'Doe',
        },
        emails: {
          primaryEmail: 'Jane@Example.com',
          additionalEmails: null,
        },
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://www.linkedin.com/in/jane/?trk=profile',
          secondaryLinks: null,
        },
      }),
    );

    expect(input).toEqual({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      linkedinUrl: 'https://www.linkedin.com/in/jane',
    });
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

  it('maps only a missing phone for phone-only enrichment', () => {
    const person = buildPerson({
      emails: {
        primaryEmail: 'existing@example.com',
        additionalEmails: null,
      },
      jobTitle: 'Existing title',
    });

    expect(
      mapper.mapApolloPersonPhoneToTwentyUpdate({
        person,
        apolloPerson: {
          email: 'apollo@example.com',
          title: 'Apollo title',
          phone_numbers: [
            {
              sanitized_number: '+14155550100',
            },
          ],
        },
      }),
    ).toEqual({
      phones: {
        primaryPhoneNumber: '+14155550100',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
    });
  });

  it('considers a missing phone a general enrichment gap', () => {
    expect(
      mapper.shouldEnrichPersonGeneral(
        buildPerson({
          name: {
            firstName: 'Jane',
            lastName: 'Doe',
          },
          emails: {
            primaryEmail: 'jane@example.com',
            additionalEmails: null,
          },
          linkedinLink: {
            primaryLinkLabel: '',
            primaryLinkUrl: 'https://www.linkedin.com/in/jane',
            secondaryLinks: null,
          },
          jobTitle: 'VP Sales',
          companyId: 'company-id',
        }),
      ),
    ).toBe(true);
  });

  it('maps the verified waterfall email for email-only enrichment', () => {
    expect(
      mapper.mapApolloPersonEmailToTwentyUpdate({
        person: buildPerson(),
        apolloPerson: {
          emails: [
            {
              email: 'guessed@example.com',
              email_status_cd: 'guessed',
              position: 0,
            },
            {
              email: 'Verified@Example.com',
              email_status_cd: 'verified',
              position: 1,
            },
          ],
        },
      }),
    ).toEqual({
      emails: {
        primaryEmail: 'verified@example.com',
        additionalEmails: ['guessed@example.com'],
      },
    });
  });

  it('keeps a manual primary email and adds a different waterfall email', () => {
    expect(
      mapper.mapApolloPersonEmailToTwentyUpdate({
        person: buildPerson({
          emails: {
            primaryEmail: 'manual@example.com',
            additionalEmails: null,
          },
          createdBy: {
            context: {},
            name: 'Manual User',
            source: FieldActorSource.MANUAL,
            workspaceMemberId: null,
          },
        }),
        apolloPerson: {
          emails: [
            {
              email: 'waterfall@example.com',
              email_status_cd: 'verified',
            },
          ],
        },
      }),
    ).toEqual({
      emails: {
        primaryEmail: 'manual@example.com',
        additionalEmails: ['waterfall@example.com'],
      },
    });
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

  it('maps Apollo company firmographic data without company phone data', () => {
    const mappedCompany = mapper.mapApolloOrganization({
      name: 'Acme',
      primary_domain: 'acme.com',
      industry: 'Software',
      keywords: ['crm', ' sales '],
      current_technologies: [{ name: 'TypeScript' }, { name: 'Postgres' }],
      estimated_num_employees: 42,
      annual_revenue: '1,250,000',
      street_address: '1 Main Street',
      city: 'Helsinki',
      country: 'Finland',
      latitude: '60.1699',
      longitude: '24.9384',
    });

    expect(mappedCompany).toMatchObject({
      employees: 42,
      industry: 'Software',
      keywords: ['crm', 'sales'],
      technologies: ['TypeScript', 'Postgres'],
      annualRevenue: {
        amountMicros: 1_250_000_000_000,
        currencyCode: 'USD',
      },
      address: {
        addressStreet1: '1 Main Street',
        addressCity: 'Helsinki',
        addressCountry: 'Finland',
        addressLat: 60.1699,
        addressLng: 24.9384,
      },
    });
    expect(mappedCompany).not.toHaveProperty('companyPhone');
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
