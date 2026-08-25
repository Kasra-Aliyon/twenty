import { FieldActorSource } from 'twenty-shared/types';

import {
  APOLLO_PHONE_ENRICHMENT_POLL_INTERVAL_MS,
  APOLLO_PHONE_ENRICHMENT_POLL_JOB_NAME,
  APOLLO_PHONE_ENRICHMENT_POLL_RETRY_LIMIT,
} from 'src/modules/apollo-enrichment/apollo-enrichment.constants';
import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';
import { ApolloEnrichmentMapperService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import {
  ApolloEnrichmentError,
  ApolloEnrichmentProviderRejectedError,
} from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';
import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

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
  const enrollmentRepository = {
    find: jest.fn(),
    update: jest.fn(),
  };
  const transactionManager = { id: 'transaction-manager' };
  const workspaceDataSource = {
    transaction: jest.fn(
      async <T>(callback: (manager: unknown) => Promise<T>): Promise<T> =>
        callback(transactionManager),
    ),
  };
  const apolloClientService = {
    enrichPerson: jest.fn(),
    enrichOrganization: jest.fn(),
    pollPhoneEnrichment: jest.fn(),
  };
  const messageQueueService = {
    add: jest.fn(),
  };
  const acquireLockWithToken = jest.fn();
  const renewLockWithToken = jest.fn();
  const releaseLockWithToken = jest.fn();
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

      if (entity === SequenceEnrollmentWorkspaceEntity) {
        return enrollmentRepository;
      }

      return companyRepository;
    }),
    getGlobalWorkspaceDataSource: jest.fn(async () => workspaceDataSource),
  };
  const service = new ApolloEnrichmentService(
    apolloClientService as unknown as ApolloClientService,
    new ApolloEnrichmentMapperService(),
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
    twentyConfigService as unknown as TwentyConfigService,
    {
      acquireLockWithToken,
      renewLockWithToken,
      releaseLockWithToken,
    } as unknown as CacheStorageService,
    messageQueueService as unknown as MessageQueueService,
  );

  const createPendingPhoneWebhookToken = async (): Promise<string> => {
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

    if (!token) {
      throw new Error('Expected a signed Apollo webhook token');
    }

    jest.clearAllMocks();

    return token;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    acquireLockWithToken.mockResolvedValue(true);
    renewLockWithToken.mockResolvedValue(true);
    releaseLockWithToken.mockResolvedValue(true);
    configValues.APOLLO_ENRICHMENT_ENABLED = true;
    configValues.APOLLO_ENRICHMENT_BACKFILL_ENABLED = true;
    configValues.APOLLO_REVEAL_PERSONAL_EMAILS = false;
    configValues.APOLLO_REVEAL_PHONE_NUMBER = false;
    configValues.APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL =
      'https://hooks.example.com';
    configValues.SERVER_URL = 'https://twenty.example.com';
    personRepository.findOne.mockResolvedValue(buildPerson());
    personRepository.find.mockResolvedValue([]);
    personRepository.update.mockResolvedValue({ affected: 1 });
    enrollmentRepository.find.mockResolvedValue([{ id: 'enrollment-id' }]);
    enrollmentRepository.update.mockResolvedValue({ affected: 1 });
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
    apolloClientService.pollPhoneEnrichment.mockResolvedValue({
      status: 'pending',
    });
    messageQueueService.add.mockResolvedValue(undefined);
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
    expect(personRepository.update).toHaveBeenCalledWith(
      personId,
      {
        phones: {
          primaryPhoneNumber: '+14155550100',
          primaryPhoneCountryCode: '',
          primaryPhoneCallingCode: '',
          additionalPhones: null,
        },
      },
      transactionManager,
    );
    expect(personRepository.findOne).toHaveBeenCalledWith(
      {
        lock: { mode: 'pessimistic_write' },
        where: { id: personId },
      },
      transactionManager,
    );
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
      expect.any(Function),
    );
    expect(personRepository.update).toHaveBeenCalledWith(
      personId,
      {
        phones: {
          primaryPhoneNumber: '+14155550100',
          primaryPhoneCountryCode: '',
          primaryPhoneCallingCode: '',
          additionalPhones: null,
        },
      },
      transactionManager,
    );
  });

  it('queues zero-credit polling for an asynchronous phone result', async () => {
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          request_id: '1039995589705121900',
          person: {
            id: 'apollo-person-id',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('pending');

    expect(messageQueueService.add).toHaveBeenCalledWith(
      APOLLO_PHONE_ENRICHMENT_POLL_JOB_NAME,
      {
        matchFingerprint: expect.any(String),
        personId,
        requestId: '1039995589705121900',
        requestToken: expect.any(String),
        workspaceId,
      },
      {
        backoff: {
          type: 'fixed',
          delay: APOLLO_PHONE_ENRICHMENT_POLL_INTERVAL_MS,
        },
        delay: APOLLO_PHONE_ENRICHMENT_POLL_INTERVAL_MS,
        id: expect.stringMatching(
          new RegExp(
            `^apollo-phone-enrichment-poll:${workspaceId}:${personId}:`,
          ),
        ),
        retryLimit: APOLLO_PHONE_ENRICHMENT_POLL_RETRY_LIMIT,
      },
    );
  });

  it('persists a completed polled phone result when the webhook is missed', async () => {
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          request_id: '1039995589705121900',
          person: {
            id: 'apollo-person-id',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('pending');

    const pollJobData = messageQueueService.add.mock.calls[0][1];

    apolloClientService.pollPhoneEnrichment.mockResolvedValue({
      payload: {
        people: [
          {
            id: 'apollo-person-id',
            sanitized_phone: '+14155550100',
          },
        ],
        status: 'success',
      },
      status: 'ready',
    });

    await expect(service.pollPhoneEnrichment(pollJobData)).resolves.toBe(
      'resolved',
    );

    expect(apolloClientService.pollPhoneEnrichment).toHaveBeenCalledWith(
      '1039995589705121900',
    );
    expect(personRepository.update).toHaveBeenCalledWith(
      personId,
      {
        phones: {
          primaryPhoneNumber: '+14155550100',
          primaryPhoneCountryCode: '',
          primaryPhoneCallingCode: '',
          additionalPhones: null,
        },
      },
      transactionManager,
    );
  });

  it('deduplicates concurrent phone reveals across all Apollo callers', async () => {
    acquireLockWithToken
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          request_id: 'request-id',
          person: {
            id: 'apollo-person-id',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('pending');
    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('pending');

    expect(acquireLockWithToken).toHaveBeenCalledTimes(2);
    expect(acquireLockWithToken).toHaveBeenNthCalledWith(
      1,
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
      60_000,
    );
    expect(renewLockWithToken).toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
      86_400_000,
    );
    expect(apolloClientService.enrichPerson).toHaveBeenCalledTimes(1);
    expect(releaseLockWithToken).not.toHaveBeenCalled();
  });

  it('fails closed before a paid reveal when global coordination is unavailable', async () => {
    acquireLockWithToken.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('request coordination failed'),
      retryable: true,
    });

    expect(apolloClientService.enrichPerson).not.toHaveBeenCalled();
  });

  it('releases the short phone lock when post-admission preflight fails', async () => {
    const readError = new Error('person database unavailable');

    personRepository.findOne
      .mockResolvedValueOnce(buildPerson())
      .mockRejectedValueOnce(readError);

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).rejects.toBe(readError);

    const [lockKey, lockToken] = acquireLockWithToken.mock.calls[0];

    expect(renewLockWithToken).toHaveBeenCalledWith(lockKey, lockToken, 60_000);
    expect(releaseLockWithToken).toHaveBeenCalledWith(lockKey, lockToken);
    expect(apolloClientService.enrichPerson).not.toHaveBeenCalled();
  });

  it('fails before Apollo when the short phone lock cannot be renewed', async () => {
    const onProviderStart = jest.fn().mockResolvedValue(undefined);

    renewLockWithToken.mockResolvedValue(false);
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          request_id: 'request-id',
          person: { id: 'apollo-person-id' },
        };
      },
    );

    await expect(
      service.enrichPerson({
        workspaceId,
        personId,
        mode: 'phone',
        onProviderStart,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('could not be renewed'),
      retryable: true,
    });

    expect(onProviderStart).toHaveBeenCalledTimes(1);
    expect(onProviderStart.mock.invocationCallOrder[0]).toBeLessThan(
      renewLockWithToken.mock.invocationCallOrder[0],
    );
    expect(renewLockWithToken).toHaveBeenCalledTimes(2);
    expect(releaseLockWithToken).not.toHaveBeenCalled();
  });

  it('still performs general automatic enrichment when a phone reveal is already running', async () => {
    configValues.APOLLO_REVEAL_PHONE_NUMBER = true;
    acquireLockWithToken.mockResolvedValue(false);
    apolloClientService.enrichPerson.mockResolvedValue({
      person: {
        email: 'jane@example.com',
        title: 'VP Sales',
      },
    });

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'automatic' }),
    ).resolves.toBe('updated');

    expect(apolloClientService.enrichPerson).toHaveBeenCalledWith(
      { linkedinUrl: 'https://www.linkedin.com/in/jane' },
      {
        revealPersonalEmails: false,
        revealPhoneNumber: false,
        webhookUrl: undefined,
      },
    );
    expect(personRepository.update).toHaveBeenCalledWith(personId, {
      emails: {
        primaryEmail: 'jane@example.com',
        additionalEmails: null,
      },
      jobTitle: 'VP Sales',
    });
  });

  it('rechecks the person after acquiring the global phone lock', async () => {
    personRepository.findOne
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce({
        ...buildPerson(),
        phones: {
          primaryPhoneNumber: '+14155550100',
          primaryPhoneCountryCode: 'US',
          primaryPhoneCallingCode: '+1',
          additionalPhones: null,
        },
      } as PersonWorkspaceEntity);

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('skipped');

    expect(apolloClientService.enrichPerson).not.toHaveBeenCalled();
    const [lockKey, lockToken] = acquireLockWithToken.mock.calls[0];

    expect(releaseLockWithToken).toHaveBeenCalledWith(lockKey, lockToken);
  });

  it('releases the global phone lock when provider admission is rejected', async () => {
    const admissionError = new Error('sequence was paused');

    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          request_id: 'request-id',
          person: {
            id: 'apollo-person-id',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({
        workspaceId,
        personId,
        mode: 'phone',
        onProviderStart: jest.fn().mockRejectedValue(admissionError),
      }),
    ).rejects.toBe(admissionError);

    const [lockKey, lockToken] = acquireLockWithToken.mock.calls[0];

    expect(releaseLockWithToken).toHaveBeenCalledWith(lockKey, lockToken);
    expect(apolloClientService.enrichPerson).toHaveBeenCalledTimes(1);
    expect(renewLockWithToken).not.toHaveBeenCalledWith(
      lockKey,
      lockToken,
      86_400_000,
    );
  });

  it.each([
    { retryable: false, statusCode: 401 },
    { retryable: true, statusCode: 429 },
  ])(
    'releases a phone request after a definitive Apollo $statusCode rejection',
    async ({ retryable, statusCode }) => {
      apolloClientService.enrichPerson.mockImplementation(
        async (_input, _options, onProviderStart?: () => Promise<void>) => {
          await onProviderStart?.();

          throw new ApolloEnrichmentError(
            `Apollo API request failed with status ${statusCode}`,
            retryable,
            statusCode,
          );
        },
      );

      await expect(
        service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
      ).rejects.toMatchObject({
        constructor: ApolloEnrichmentProviderRejectedError,
        retryable,
        statusCode,
      });

      expect(releaseLockWithToken).toHaveBeenCalledWith(
        `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
        expect.any(String),
      );
    },
  );

  it('does not overwrite a phone written while Apollo was running', async () => {
    personRepository.findOne
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce({
        ...buildPerson(),
        phones: {
          primaryPhoneNumber: '+358401111111',
          primaryPhoneCountryCode: 'FI',
          primaryPhoneCallingCode: '+358',
          additionalPhones: null,
        },
      } as PersonWorkspaceEntity);
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          person: {
            sanitized_phone: '+14155550100',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('skipped');

    expect(personRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).toHaveBeenCalled();
  });

  it('does not persist an Apollo phone after the person match identity changes', async () => {
    personRepository.findOne
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce(
        buildPerson({
          linkedinLink: {
            primaryLinkLabel: '',
            primaryLinkUrl: 'https://www.linkedin.com/in/different-person',
            secondaryLinks: null,
          },
        }),
      );
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          person: {
            sanitized_phone: '+14155550100',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('identity-changed');

    expect(personRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).toHaveBeenCalled();
  });

  it('preserves concurrently written phone metadata when adding the Apollo primary phone', async () => {
    personRepository.findOne
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce(buildPerson())
      .mockResolvedValueOnce({
        ...buildPerson(),
        phones: {
          primaryPhoneNumber: '',
          primaryPhoneCountryCode: 'FI',
          primaryPhoneCallingCode: '+358',
          additionalPhones: [
            {
              number: '+358402222222',
              countryCode: 'FI',
              callingCode: '+358',
            },
          ],
        },
      } as PersonWorkspaceEntity);
    apolloClientService.enrichPerson.mockImplementation(
      async (_input, _options, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          person: {
            sanitized_phone: '+14155550100',
          },
        };
      },
    );

    await expect(
      service.enrichPerson({ workspaceId, personId, mode: 'phone' }),
    ).resolves.toBe('updated');

    expect(personRepository.update).toHaveBeenCalledWith(
      personId,
      {
        phones: {
          primaryPhoneNumber: '+14155550100',
          primaryPhoneCountryCode: 'FI',
          primaryPhoneCallingCode: '+358',
          additionalPhones: [
            {
              number: '+358402222222',
              countryCode: 'FI',
              callingCode: '+358',
            },
          ],
        },
      },
      transactionManager,
    );
  });

  it('deduplicates repeated person ids inside one enrichment batch', async () => {
    const enrichPersonSpy = jest
      .spyOn(service, 'enrichPerson')
      .mockResolvedValue('updated');

    await expect(
      service.enrichPeople({
        workspaceId,
        personIds: [personId, personId],
        mode: 'phone',
        authContext: buildSystemAuthContext(workspaceId),
      }),
    ).resolves.toEqual({
      requestedCount: 2,
      updatedCount: 1,
      pendingCount: 0,
      skippedCount: 1,
      notMatchedCount: 0,
      notFoundCount: 0,
      failedCount: 0,
      disabled: false,
    });

    expect(enrichPersonSpy).toHaveBeenCalledTimes(1);
    enrichPersonSpy.mockRestore();
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
    const token = await createPendingPhoneWebhookToken();

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

    expect(personRepository.update).toHaveBeenCalledWith(
      personId,
      {
        phones: {
          primaryPhoneNumber: '+14155550100',
          primaryPhoneCountryCode: '',
          primaryPhoneCallingCode: '',
          additionalPhones: null,
        },
      },
      transactionManager,
    );
    expect(releaseLockWithToken).toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it.each([
    {
      name: 'failed',
      payload: { status: 'failed' as const },
    },
    {
      name: 'success without a phone',
      payload: {
        status: 'success' as const,
        people: [{ id: 'apollo-person-id' }],
      },
    },
  ])(
    'wakes the started sequence cohort after a $name webhook',
    async ({ payload }) => {
      const token = await createPendingPhoneWebhookToken();

      await service.handlePhoneEnrichmentWebhook({ token, payload });

      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        {
          personId,
          status: 'ACTIVE',
          waitingOn: 'APOLLO_ENRICHMENT',
        },
        {
          nextActionAt: expect.any(Date),
        },
        transactionManager,
      );
      expect(renewLockWithToken).toHaveBeenNthCalledWith(
        1,
        `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
        expect.any(String),
        86_400_000,
      );
      expect(renewLockWithToken).toHaveBeenLastCalledWith(
        `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
        expect.any(String),
        60_000,
      );
      expect(releaseLockWithToken).toHaveBeenCalledWith(
        `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
        expect.any(String),
      );
    },
  );

  it('does not let a stale webhook wake a newer Apollo request cohort', async () => {
    const token = await createPendingPhoneWebhookToken();

    renewLockWithToken.mockResolvedValue(false);

    await service.handlePhoneEnrichmentWebhook({
      token,
      payload: { status: 'failed' },
    });

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).not.toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it('serializes concurrent webhook deliveries for the same request', async () => {
    const token = await createPendingPhoneWebhookToken();

    acquireLockWithToken.mockResolvedValue(false);

    await expect(
      service.handlePhoneEnrichmentWebhook({
        token,
        payload: { status: 'failed' },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('already in progress'),
      retryable: true,
    });

    expect(renewLockWithToken).not.toHaveBeenCalled();
    expect(personRepository.update).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('fences a successful webhook that loses its processing lease while waiting for the person lock', async () => {
    const token = await createPendingPhoneWebhookToken();

    renewLockWithToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.handlePhoneEnrichmentWebhook({
      token,
      payload: {
        status: 'success',
        people: [
          {
            id: 'apollo-person-id',
            phone_numbers: [{ sanitized_number: '+14155550100' }],
          },
        ],
      },
    });

    expect(personRepository.update).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).not.toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it('fences a terminal webhook that loses its processing lease while waiting for enrollment locks', async () => {
    const token = await createPendingPhoneWebhookToken();

    renewLockWithToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.handlePhoneEnrichmentWebhook({
      token,
      payload: { status: 'failed' },
    });

    expect(enrollmentRepository.find).toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).not.toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it('does not let a stale successful webhook overwrite the current request', async () => {
    const token = await createPendingPhoneWebhookToken();

    renewLockWithToken.mockResolvedValue(false);

    await service.handlePhoneEnrichmentWebhook({
      token,
      payload: {
        status: 'success',
        people: [
          {
            id: 'stale-apollo-person-id',
            phone_numbers: [{ sanitized_number: '+14155550100' }],
          },
        ],
      },
    });

    expect(personRepository.findOne).not.toHaveBeenCalled();
    expect(personRepository.update).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).not.toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it('does not apply a current webhook after the person match identity changes', async () => {
    const token = await createPendingPhoneWebhookToken();

    personRepository.findOne.mockResolvedValue(
      buildPerson({
        linkedinLink: {
          primaryLinkLabel: '',
          primaryLinkUrl: 'https://www.linkedin.com/in/different-person',
          secondaryLinks: null,
        },
      }),
    );

    await service.handlePhoneEnrichmentWebhook({
      token,
      payload: {
        status: 'success',
        people: [
          {
            id: 'apollo-person-id',
            phone_numbers: [{ sanitized_number: '+14155550100' }],
          },
        ],
      },
    });

    expect(personRepository.update).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        personId,
        waitingOn: 'APOLLO_ENRICHMENT',
      }),
      expect.objectContaining({
        waitingOn: 'DELAY',
        nextActionAt: expect.any(Date),
      }),
      transactionManager,
    );
    expect(releaseLockWithToken).toHaveBeenCalled();
  });

  it('retains webhook ownership when coordination cannot confirm the token', async () => {
    const token = await createPendingPhoneWebhookToken();

    renewLockWithToken.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.handlePhoneEnrichmentWebhook({
        token,
        payload: { status: 'failed' },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('could not confirm its request lease'),
      retryable: true,
    });

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(releaseLockWithToken).not.toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it('retains webhook ownership when waking the sequence cohort fails', async () => {
    const token = await createPendingPhoneWebhookToken();
    const wakeError = new Error('enrollment database unavailable');

    enrollmentRepository.update.mockRejectedValue(wakeError);

    await expect(
      service.handlePhoneEnrichmentWebhook({
        token,
        payload: { status: 'failed' },
      }),
    ).rejects.toBe(wakeError);

    expect(renewLockWithToken).toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
      86_400_000,
    );
    expect(releaseLockWithToken).not.toHaveBeenCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
    );
  });

  it('surfaces webhook lock-release failures after bounding the lease', async () => {
    const token = await createPendingPhoneWebhookToken();

    releaseLockWithToken.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.handlePhoneEnrichmentWebhook({
        token,
        payload: { status: 'failed' },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('could not release its request lease'),
      retryable: true,
    });

    expect(enrollmentRepository.update).toHaveBeenCalled();
    expect(renewLockWithToken).toHaveBeenLastCalledWith(
      `apollo-phone-enrichment-request:${workspaceId}:${personId}`,
      expect.any(String),
      60_000,
    );
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
