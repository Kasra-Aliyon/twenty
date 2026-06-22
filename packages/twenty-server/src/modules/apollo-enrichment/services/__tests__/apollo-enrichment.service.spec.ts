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
    APOLLO_ENRICHMENT_ENABLED: true,
    APOLLO_ENRICHMENT_BACKFILL_ENABLED: true,
    APOLLO_ENRICHMENT_BACKFILL_LIMIT: 50,
    APOLLO_ENRICHMENT_RETRY_SECONDS: 3600,
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
