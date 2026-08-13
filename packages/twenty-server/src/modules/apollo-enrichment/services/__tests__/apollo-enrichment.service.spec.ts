import { FieldActorSource } from 'twenty-shared/types';

import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';
import { ApolloEnrichmentMapperService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

describe('ApolloEnrichmentService', () => {
  const workspaceId = 'workspace-id';
  const personId = 'person-id';

  const buildPerson = (
    overrides: Partial<PersonWorkspaceEntity> = {},
  ): PersonWorkspaceEntity =>
    ({
      id: personId,
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
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/in/jane',
        secondaryLinks: null,
      },
      jobTitle: null,
      companyId: null,
      ...overrides,
    }) as PersonWorkspaceEntity;

  const personRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };
  const companyRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    maximum: jest.fn(),
    save: jest.fn(),
  };
  const apolloClientService = {
    enrichPerson: jest.fn(),
    enrichOrganization: jest.fn(),
  };
  const configValues: Partial<ConfigVariables> = {
    APP_SECRET: 'test-app-secret',
    APOLLO_ENRICHMENT_ENABLED: true,
    APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL: 'https://hooks.example.com',
    APOLLO_REVEAL_PERSONAL_EMAILS: false,
    APOLLO_REVEAL_PHONE_NUMBER: false,
    APOLLO_ENRICHMENT_BACKFILL_ENABLED: true,
    APOLLO_ENRICHMENT_BACKFILL_LIMIT: 50,
    APOLLO_ENRICHMENT_RETRY_SECONDS: 3600,
    SERVER_URL: 'https://twenty.example.com',
  };
  const twentyConfigService = {
    get: jest.fn(
      <T extends keyof ConfigVariables>(key: T): ConfigVariables[T] =>
        configValues[key] as ConfigVariables[T],
    ),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(
      async <T>(callback: () => Promise<T>): Promise<T> => callback(),
    ),
    getRepository: jest.fn(async (_workspaceId: string, entity: unknown) => {
      if (entity === PersonWorkspaceEntity) {
        return personRepository;
      }

      return companyRepository;
    }),
  };
  const service = new ApolloEnrichmentService(
    apolloClientService as unknown as ApolloClientService,
    new ApolloEnrichmentMapperService(),
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
    twentyConfigService as unknown as TwentyConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.APOLLO_ENRICHMENT_ENABLED = true;
    configValues.APOLLO_ENRICHMENT_BACKFILL_ENABLED = true;
    configValues.APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL =
      'https://hooks.example.com';
    configValues.SERVER_URL = 'https://twenty.example.com';
    personRepository.findOne.mockResolvedValue(buildPerson());
    personRepository.find.mockResolvedValue([]);
    personRepository.update.mockResolvedValue(undefined);
    companyRepository.find.mockResolvedValue([]);
    companyRepository.findOne.mockResolvedValue(null);
    companyRepository.update.mockResolvedValue(undefined);
    companyRepository.maximum.mockResolvedValue(0);
    companyRepository.save.mockResolvedValue({
      id: 'created-company-id',
    } as CompanyWorkspaceEntity);
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'jane@example.com',
      },
    });
    apolloClientService.enrichOrganization.mockResolvedValue({
      organization: null,
    });
  });

  it('skips when Apollo enrichment is disabled', async () => {
    configValues.APOLLO_ENRICHMENT_ENABLED = false;

    const result = await service.enrichPerson({
      workspaceId,
      personId,
    });

    expect(result).toBe('disabled');
    expect(globalWorkspaceOrmManager.getRepository).not.toHaveBeenCalled();
  });

  it('skips people without enough match input', async () => {
    personRepository.findOne.mockResolvedValue(
      buildPerson({
        linkedinLink: null,
      }),
    );

    const result = await service.enrichPerson({
      workspaceId,
      personId,
    });

    expect(result).toBe('skipped');
    expect(apolloClientService.enrichPerson).not.toHaveBeenCalled();
  });

  it('only fills empty person fields', async () => {
    personRepository.findOne.mockResolvedValue(
      buildPerson({
        emails: {
          primaryEmail: 'existing@example.com',
          additionalEmails: null,
        },
        jobTitle: 'Existing title',
        companyId: 'existing-company-id',
      }),
    );
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'apollo@example.com',
        sanitized_phone: '+14155550100',
        title: 'Apollo title',
      },
    });

    const result = await service.enrichPerson({
      workspaceId,
      personId,
    });

    expect(result).toBe('updated');
    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      phones: {
        primaryPhoneNumber: '+14155550100',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
    });
  });

  it('excludes phone numbers from general person enrichment', async () => {
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'jane@example.com',
        sanitized_phone: '+14155550100',
      },
    });

    const result = await service.enrichPerson({
      workspaceId,
      personId,
      mode: 'general',
    });

    expect(result).toBe('updated');
    expect(apolloClientService.enrichPerson).toHaveBeenCalledWith(
      {
        linkedinUrl: 'https://www.linkedin.com/in/jane',
      },
      {
        revealPersonalEmails: false,
        revealPhoneNumber: false,
      },
    );
    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      emails: {
        primaryEmail: 'jane@example.com',
        additionalEmails: null,
      },
    });
  });

  it('updates only the phone during phone enrichment', async () => {
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'jane@example.com',
        sanitized_phone: '+14155550100',
        title: 'VP Sales',
      },
    });

    const result = await service.enrichPerson({
      workspaceId,
      personId,
      mode: 'phone',
    });

    expect(result).toBe('updated');
    expect(apolloClientService.enrichPerson).toHaveBeenCalledWith(
      {
        linkedinUrl: 'https://www.linkedin.com/in/jane',
      },
      expect.objectContaining({
        revealPersonalEmails: false,
        revealPhoneNumber: true,
        webhookUrl: expect.stringMatching(
          /^https:\/\/hooks\.example\.com\/webhooks\/apollo\/enrichment\//,
        ),
      }),
    );
    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      phones: {
        primaryPhoneNumber: '+14155550100',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
    });
  });

  it('rejects phone enrichment without a public HTTPS webhook base URL', async () => {
    configValues.APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL = undefined;
    configValues.SERVER_URL = 'http://localhost:2000';

    await expect(
      service.enrichPerson({
        workspaceId,
        personId,
        mode: 'phone',
      }),
    ).rejects.toThrow(
      'Apollo phone enrichment requires APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL or SERVER_URL to use public HTTPS',
    );
    expect(apolloClientService.enrichPerson).not.toHaveBeenCalled();
  });

  it('updates a person when Apollo delivers the asynchronous phone webhook', async () => {
    apolloClientService.enrichPerson.mockResolvedValue({
      request_id: 'request-id',
      person: {
        id: 'apollo-person-id',
      },
    });

    await expect(
      service.enrichPerson({
        workspaceId,
        personId,
        mode: 'phone',
      }),
    ).resolves.toBe('pending');

    const enrichmentOptions = apolloClientService.enrichPerson.mock.calls[0][1];
    const webhookUrl = new URL(enrichmentOptions.webhookUrl);
    const token = webhookUrl.pathname.split('/').pop();

    jest.clearAllMocks();
    personRepository.findOne.mockResolvedValue(buildPerson());

    await service.handlePhoneEnrichmentWebhook({
      token: token ?? '',
      payload: {
        status: 'success',
        people: [
          {
            id: 'apollo-person-id',
            phone_numbers: [
              {
                sanitized_number: '+14155550100',
              },
            ],
          },
        ],
      },
    });

    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      phones: {
        primaryPhoneNumber: '+14155550100',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
    });
  });

  it('ignores Apollo phone webhooks with an invalid correlation token', async () => {
    await service.handlePhoneEnrichmentWebhook({
      token: 'invalid-token',
      payload: {
        status: 'success',
        people: [
          {
            phone_numbers: [
              {
                sanitized_number: '+14155550100',
              },
            ],
          },
        ],
      },
    });

    expect(personRepository.update).not.toHaveBeenCalled();
  });

  it('enriches empty company fields without updating company phone data', async () => {
    companyRepository.findOne.mockResolvedValue({
      id: 'company-id',
      name: 'Acme',
      domainName: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://acme.com',
        secondaryLinks: null,
      },
      linkedinLink: null,
      employees: null,
      industry: null,
      keywords: null,
      technologies: null,
      annualRevenue: null,
      address: null,
      deletedAt: null,
    } as unknown as CompanyWorkspaceEntity);
    apolloClientService.enrichOrganization.mockResolvedValue({
      organization: {
        name: 'Acme',
        primary_domain: 'acme.com',
        linkedin_url: 'https://www.linkedin.com/company/acme',
        estimated_num_employees: 42,
        industry: 'Software',
      },
    });

    const result = await service.enrichCompany({
      workspaceId,
      companyId: 'company-id',
    });

    expect(result).toBe('updated');
    expect(companyRepository.update).toHaveBeenCalledWith('company-id', {
      linkedinLink: {
        primaryLinkLabel: '',
        primaryLinkUrl: 'https://www.linkedin.com/company/acme',
        secondaryLinks: null,
      },
      employees: 42,
      industry: 'Software',
    });
    expect(companyRepository.update.mock.calls[0][1]).not.toHaveProperty(
      'companyPhone',
    );
  });

  it('refreshes existing email for restored auto-created contact records', async () => {
    personRepository.findOne.mockResolvedValue(
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
        jobTitle: 'Existing title',
        companyId: 'existing-company-id',
        createdBy: {
          source: FieldActorSource.EMAIL,
          workspaceMemberId: null,
          name: 'System',
          context: {},
        },
      }),
    );
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'apollo@example.com',
        sanitized_phone: '+14155550199',
        title: 'Apollo title',
      },
    });

    const result = await service.enrichPerson({
      workspaceId,
      personId,
    });

    expect(result).toBe('updated');
    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      emails: {
        primaryEmail: 'apollo@example.com',
        additionalEmails: null,
      },
    });
  });

  it('matches Apollo organizations to existing companies by domain', async () => {
    companyRepository.find.mockResolvedValue([
      {
        id: 'company-id',
        name: 'Acme',
        domainName: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://acme.com',
          secondaryLinks: null,
        },
        linkedinLink: null,
        deletedAt: null,
      },
    ]);
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'jane@example.com',
        organization: {
          name: 'Acme',
          primary_domain: 'acme.com',
        },
      },
    });

    const result = await service.enrichPerson({
      workspaceId,
      personId,
    });

    expect(result).toBe('updated');
    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      emails: {
        primaryEmail: 'jane@example.com',
        additionalEmails: null,
      },
      companyId: 'company-id',
    });
    expect(companyRepository.save).not.toHaveBeenCalled();
  });

  it('finds backfill candidates and honors retry cooldown', async () => {
    personRepository.find.mockResolvedValue([
      buildPerson({ id: 'candidate-id' }),
    ]);

    const firstResult = await service.findBackfillCandidatePersonIds({
      workspaceId,
      limit: 10,
    });

    service.markBackfillAttempted({
      workspaceId,
      personId: 'candidate-id',
    });

    const secondResult = await service.findBackfillCandidatePersonIds({
      workspaceId,
      limit: 10,
    });

    expect(firstResult).toEqual(['candidate-id']);
    expect(secondResult).toEqual([]);
  });
});
