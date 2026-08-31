import { Injectable, Logger } from '@nestjs/common';

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import {
  FieldActorSource,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
  type ActorMetadata,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type DeepPartial, ILike } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import {
  APOLLO_PHONE_ENRICHMENT_POLL_INTERVAL_MS,
  APOLLO_PHONE_ENRICHMENT_POLL_JOB_ID_PREFIX,
  APOLLO_PHONE_ENRICHMENT_POLL_JOB_NAME,
  APOLLO_PHONE_ENRICHMENT_POLL_RETRY_LIMIT,
} from 'src/modules/apollo-enrichment/apollo-enrichment.constants';
import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';
import {
  type ApolloCompanyMappedFields,
  ApolloEnrichmentMapperService,
  hasText,
} from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import {
  type ApolloOrganization,
  type ApolloPerson,
  type ApolloPersonMatchInput,
  type ApolloEnrichmentWebhookPayload,
  type ApolloPersonEnrichmentOptions,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import {
  ApolloEnrichmentError,
  ApolloEnrichmentProviderNotStartedError,
  ApolloEnrichmentProviderRejectedError,
} from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

export type ApolloEnrichmentResult =
  | 'disabled'
  | 'identity-changed'
  | 'pending'
  | 'skipped'
  | 'not-found'
  | 'not-matched'
  | 'updated-pending'
  | 'updated';

export type ApolloPersonEnrichmentMode = 'automatic' | 'general' | 'phone';

export type ApolloEnrichmentBatchResult = {
  requestedCount: number;
  updatedCount: number;
  pendingCount: number;
  skippedCount: number;
  notMatchedCount: number;
  notFoundCount: number;
  failedCount: number;
  disabled: boolean;
};

const APOLLO_ENRICHMENT_BATCH_CONCURRENCY = 10;
const APOLLO_PHONE_PRE_PROVIDER_LOCK_TTL_MS = 60 * 1000;
const APOLLO_PHONE_WEBHOOK_PROCESSING_LOCK_TTL_MS = 5 * 60 * 1000;
const APOLLO_PHONE_WEBHOOK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const APOLLO_PHONE_ENRICHMENT_LOCK_KEY_PREFIX =
  'apollo-phone-enrichment-request';

type ApolloAsyncEnrichmentTarget = 'email' | 'phone';

type ApolloPhoneWebhookTokenPayload = {
  expiresAt: number;
  matchFingerprint?: string;
  personId: string;
  requestToken?: string;
  target?: ApolloAsyncEnrichmentTarget;
  workspaceId: string;
};

type ApolloPhoneEnrichmentLock = {
  key: string;
  target: ApolloAsyncEnrichmentTarget;
  token: string;
};

type ApolloPhonePersistenceOutcome =
  | 'already-present'
  | 'identity-changed'
  | 'missing'
  | 'not-found'
  | 'ownership-lost'
  | 'updated';

export type ApolloEnrichmentPollOutcome = 'pending' | 'resolved' | 'stale';

@Injectable()
export class ApolloEnrichmentService {
  private readonly logger = new Logger(ApolloEnrichmentService.name);
  private readonly backfillAttemptedAtByPersonKey = new Map<string, number>();

  constructor(
    private readonly apolloClientService: ApolloClientService,
    private readonly apolloEnrichmentMapperService: ApolloEnrichmentMapperService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectCacheStorage(CacheStorageNamespace.EngineLock)
    private readonly cacheStorageService: CacheStorageService,
    @InjectMessageQueue(MessageQueue.apolloEnrichmentQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async enrichPerson({
    workspaceId,
    personId,
    mode = 'automatic',
    authContext = buildSystemAuthContext(workspaceId),
    onProviderStart,
  }: {
    workspaceId: string;
    personId: string;
    mode?: ApolloPersonEnrichmentMode;
    authContext?: WorkspaceAuthContext;
    onProviderStart?: () => Promise<void>;
  }): Promise<ApolloEnrichmentResult> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return 'disabled';
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const rolePermissionConfig =
          this.resolveRolePermissionConfig(authContext);
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            PersonWorkspaceEntity,
            rolePermissionConfig,
          );

        let person = await personRepository.findOne({
          where: { id: personId },
        });

        if (!isDefined(person)) {
          return 'not-found';
        }

        if (!this.shouldEnrichPersonForMode(person, mode)) {
          return 'skipped';
        }

        let matchInput = await this.buildPersonMatchInputWithCompanyContext({
          person,
          rolePermissionConfig,
          workspaceId,
        });

        if (!isDefined(matchInput)) {
          return 'skipped';
        }

        const requestToken = randomUUID();
        let enrichmentOptions = this.getPersonEnrichmentOptions({
          matchFingerprint: this.buildPersonMatchFingerprint(matchInput),
          mode,
          personId,
          requestToken,
          workspaceId,
        });
        let asyncTarget = this.getAsyncEnrichmentTarget(enrichmentOptions);
        let requestLock = isDefined(asyncTarget)
          ? await this.tryAcquirePhoneEnrichmentLock({
              personId,
              requestToken,
              target: asyncTarget,
              workspaceId,
            })
          : undefined;

        if (requestLock === null) {
          if (mode !== 'automatic') {
            return 'pending';
          }

          // A phone-only request already owns the paid reveal. Automatic
          // enrichment can still fill ordinary Apollo fields without asking
          // for another phone reveal or losing the one-shot background job.
          enrichmentOptions = {
            ...enrichmentOptions,
            revealPhoneNumber: false,
            runWaterfallEmail: false,
            runWaterfallPhone: false,
            webhookUrl: undefined,
          };
          asyncTarget = undefined;
          requestLock = undefined;
        }

        if (isDefined(requestLock)) {
          try {
            const latestPerson = await personRepository.findOne({
              where: { id: personId },
            });

            if (!isDefined(latestPerson)) {
              await this.releasePhoneEnrichmentLock(requestLock);

              return 'not-found';
            }

            if (!this.shouldEnrichPersonForMode(latestPerson, mode)) {
              await this.releasePhoneEnrichmentLock(requestLock);

              return 'skipped';
            }

            const latestMatchInput =
              await this.buildPersonMatchInputWithCompanyContext({
                person: latestPerson,
                rolePermissionConfig,
                workspaceId,
              });

            if (!isDefined(latestMatchInput)) {
              await this.releasePhoneEnrichmentLock(requestLock);

              return 'skipped';
            }

            // The first read happens before the cross-worker lease. Refresh it
            // after admission so a just-completed webhook cannot trigger a
            // second paid reveal from stale person data.
            person = latestPerson;
            matchInput = latestMatchInput;
            enrichmentOptions = this.getPersonEnrichmentOptions({
              matchFingerprint:
                this.buildPersonMatchFingerprint(latestMatchInput),
              mode,
              personId,
              requestToken,
              workspaceId,
            });
            asyncTarget = this.getAsyncEnrichmentTarget(enrichmentOptions);
          } catch (error) {
            await this.releasePhoneEnrichmentLock(requestLock);

            throw error;
          }
        }

        let providerStarted = false;
        let apolloResponse: Awaited<
          ReturnType<ApolloClientService['enrichPerson']>
        >;

        try {
          const providerStartCallback =
            isDefined(asyncTarget) || isDefined(onProviderStart)
              ? async () => {
                  await onProviderStart?.();
                  await this.renewPhoneEnrichmentLock(requestLock);
                  providerStarted = true;
                }
              : undefined;

          apolloResponse = isDefined(providerStartCallback)
            ? await this.apolloClientService.enrichPerson(
                matchInput,
                enrichmentOptions,
                providerStartCallback,
              )
            : await this.apolloClientService.enrichPerson(
                matchInput,
                enrichmentOptions,
              );
        } catch (error) {
          if (!providerStarted) {
            await this.releasePhoneEnrichmentLock(requestLock);
          }

          if (
            providerStarted &&
            error instanceof ApolloEnrichmentError &&
            isDefined(error.statusCode) &&
            error.statusCode >= 400 &&
            error.statusCode <= 499
          ) {
            await this.releasePhoneEnrichmentLock(requestLock);

            throw new ApolloEnrichmentProviderRejectedError(
              error.message,
              error.retryable,
              error.statusCode,
            );
          }

          throw error;
        }

        if (apolloResponse.waterfall?.status === 'failed') {
          await this.releasePhoneEnrichmentLock(requestLock);

          throw new ApolloEnrichmentProviderRejectedError(
            apolloResponse.waterfall.message ??
              'Apollo waterfall enrichment was rejected',
            false,
            400,
          );
        }

        const requestId = this.normalizeApolloPhoneRequestId(
          apolloResponse.request_id,
        );

        if (
          isDefined(requestLock) &&
          isDefined(asyncTarget) &&
          isDefined(requestId)
        ) {
          await this.enqueuePhoneEnrichmentPoll({
            matchFingerprint: this.buildPersonMatchFingerprint(matchInput),
            personId: person.id,
            requestId,
            requestToken: requestLock.token,
            target: asyncTarget,
            workspaceId,
          });
        }

        const apolloPerson = apolloResponse.person;

        if (!isDefined(apolloPerson)) {
          if (
            isDefined(requestLock) &&
            (apolloResponse.waterfall?.status === 'accepted' ||
              isDefined(requestId))
          ) {
            return 'pending';
          }

          await this.releasePhoneEnrichmentLock(requestLock);

          return 'not-matched';
        }

        if (mode === 'phone') {
          const phonePersistenceOutcome =
            await this.persistApolloPhoneIfStillMissing({
              apolloPerson,
              expectedMatchFingerprint:
                this.buildPersonMatchFingerprint(matchInput),
              personId: person.id,
              personRepository,
            });

          if (phonePersistenceOutcome === 'missing') {
            return 'pending';
          }

          await this.releasePhoneEnrichmentLock(requestLock);

          if (phonePersistenceOutcome === 'not-found') {
            return 'not-found';
          }

          if (phonePersistenceOutcome === 'identity-changed') {
            return 'identity-changed';
          }

          return phonePersistenceOutcome === 'updated' ? 'updated' : 'skipped';
        }

        const apolloOrganization =
          apolloResponse.organization ??
          this.apolloEnrichmentMapperService.extractApolloOrganization(
            apolloPerson,
          );
        const companyId = hasText(person.companyId)
          ? undefined
          : await this.findOrCreateCompanyFromApolloOrganization({
              workspaceId,
              apolloOrganization,
              rolePermissionConfig,
            });
        const personUpdate =
          this.apolloEnrichmentMapperService.mapApolloPersonToTwentyUpdate({
            person,
            apolloPerson,
            companyId,
          });

        if (mode === 'general') {
          delete personUpdate.phones;
        }

        const shouldPersistPhone = isDefined(personUpdate.phones);

        delete personUpdate.phones;

        const phonePersistenceOutcome = shouldPersistPhone
          ? await this.persistApolloPhoneIfStillMissing({
              apolloPerson,
              expectedMatchFingerprint:
                this.buildPersonMatchFingerprint(matchInput),
              personId: person.id,
              personRepository,
            })
          : ('missing' as const);
        const hasGeneralUpdate = Object.keys(personUpdate).length > 0;

        if (hasGeneralUpdate) {
          await personRepository.update(person.id, personUpdate);
        }

        if (shouldPersistPhone) {
          await this.releasePhoneEnrichmentLock(requestLock);
        }

        if (phonePersistenceOutcome === 'not-found') {
          return 'not-found';
        }

        if (phonePersistenceOutcome === 'already-present') {
          return hasGeneralUpdate ? 'updated' : 'skipped';
        }

        if (asyncTarget === 'email') {
          return hasGeneralUpdate ? 'updated-pending' : 'pending';
        }

        if (phonePersistenceOutcome === 'updated' || hasGeneralUpdate) {
          return 'updated';
        }

        return isDefined(asyncTarget) ? 'pending' : 'skipped';
      },
      authContext,
    );
  }

  async handleEnrichmentWebhook({
    token,
    payload,
  }: {
    token: string;
    payload: ApolloEnrichmentWebhookPayload;
  }): Promise<void> {
    const tokenPayload = this.verifyPhoneWebhookToken(token);

    if (!isDefined(tokenPayload)) {
      return;
    }

    const phoneRequestLock = hasText(tokenPayload.requestToken)
      ? this.getPhoneEnrichmentLock({
          personId: tokenPayload.personId,
          requestToken: tokenPayload.requestToken,
          target: tokenPayload.target ?? 'phone',
          workspaceId: tokenPayload.workspaceId,
        })
      : undefined;

    // Pre-generation tokens cannot prove current ownership or match identity.
    // Dropping a rolling-upgrade callback is safer than writing stale contact
    // data onto a person now owned by a newer request.
    if (!isDefined(phoneRequestLock)) {
      return;
    }

    const webhookProcessingLock =
      await this.acquirePhoneWebhookProcessingLock(phoneRequestLock);

    try {
      const apolloPerson = payload.people?.[0];
      const authContext = buildSystemAuthContext(tokenPayload.workspaceId);
      const requestOwnershipConfirmed =
        await this.confirmPhoneEnrichmentLockOwnership(phoneRequestLock);

      // A signed token can outlive its exact Redis generation. Never let an old
      // or retried webhook write data or wake the cohort owned by a newer paid
      // request.
      if (!requestOwnershipConfirmed) {
        return;
      }

      if (payload.status !== 'success' || !isDefined(apolloPerson)) {
        await this.resolvePhoneEnrichmentRequest({
          authContext,
          phoneRequestLock,
          personId: tokenPayload.personId,
          requestOwnershipConfirmed,
          retryWithNewIdentity: false,
          webhookProcessingLock,
          workspaceId: tokenPayload.workspaceId,
        });

        return;
      }

      const persistenceOutcome =
        await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
          async () => {
            const personRepository =
              await this.globalWorkspaceOrmManager.getRepository(
                tokenPayload.workspaceId,
                PersonWorkspaceEntity,
                {
                  shouldBypassPermissionChecks: true,
                },
              );

            const beforeWrite = async () =>
              this.confirmPhoneWebhookProcessingOwnership({
                phoneRequestLock,
                webhookProcessingLock,
              });

            if (phoneRequestLock.target === 'phone') {
              return this.persistApolloPhoneIfStillMissing({
                apolloPerson,
                beforePhoneWrite: beforeWrite,
                expectedMatchFingerprint: tokenPayload.matchFingerprint,
                personId: tokenPayload.personId,
                personRepository,
              });
            }

            // Phone does not participate in the match fingerprint. Persist it
            // first so an email update from the same webhook cannot make the
            // subsequent phone write look like an unrelated identity change.
            const phoneOutcome = await this.persistApolloPhoneIfStillMissing({
              apolloPerson,
              beforePhoneWrite: beforeWrite,
              expectedMatchFingerprint: tokenPayload.matchFingerprint,
              personId: tokenPayload.personId,
              personRepository,
            });

            if (
              phoneOutcome === 'identity-changed' ||
              phoneOutcome === 'not-found' ||
              phoneOutcome === 'ownership-lost'
            ) {
              return phoneOutcome;
            }

            const emailOutcome = await this.persistApolloEmailIfAllowed({
              apolloPerson,
              beforeEmailWrite: beforeWrite,
              expectedMatchFingerprint: tokenPayload.matchFingerprint,
              personId: tokenPayload.personId,
              personRepository,
            });

            if (
              emailOutcome === 'identity-changed' ||
              emailOutcome === 'not-found' ||
              emailOutcome === 'ownership-lost'
            ) {
              return emailOutcome;
            }

            return emailOutcome === 'updated' || phoneOutcome === 'updated'
              ? 'updated'
              : emailOutcome;
          },
          authContext,
        );

      if (persistenceOutcome === 'ownership-lost') {
        return;
      }

      await this.resolvePhoneEnrichmentRequest({
        authContext,
        phoneRequestLock,
        personId: tokenPayload.personId,
        requestOwnershipConfirmed,
        retryWithNewIdentity: persistenceOutcome === 'identity-changed',
        webhookProcessingLock,
        workspaceId: tokenPayload.workspaceId,
      });
    } finally {
      await this.releasePhoneWebhookProcessingLock(webhookProcessingLock);
    }
  }

  async pollEnrichment({
    matchFingerprint,
    personId,
    requestId,
    requestToken,
    target = 'phone',
    workspaceId,
  }: {
    matchFingerprint: string;
    personId: string;
    requestId: string;
    requestToken: string;
    target?: ApolloAsyncEnrichmentTarget;
    workspaceId: string;
  }): Promise<ApolloEnrichmentPollOutcome> {
    const phoneRequestLock = this.getPhoneEnrichmentLock({
      personId,
      requestToken,
      target,
      workspaceId,
    });
    const requestOwnershipConfirmed =
      await this.confirmPhoneEnrichmentLockOwnership(phoneRequestLock);

    if (!requestOwnershipConfirmed) {
      return 'stale';
    }

    const pollResult = await this.apolloClientService.pollEnrichment(requestId);

    if (pollResult.status === 'pending') {
      return 'pending';
    }

    const token = this.buildPhoneWebhookToken({
      matchFingerprint,
      personId,
      requestToken,
      target,
      workspaceId,
    });

    await this.handleEnrichmentWebhook({
      token,
      payload:
        pollResult.status === 'ready'
          ? pollResult.payload
          : { status: 'failed' },
    });

    return 'resolved';
  }

  async enrichPeople({
    workspaceId,
    personIds,
    mode,
    authContext,
  }: {
    workspaceId: string;
    personIds: string[];
    mode: Exclude<ApolloPersonEnrichmentMode, 'automatic'>;
    authContext: WorkspaceAuthContext;
  }): Promise<ApolloEnrichmentBatchResult> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return this.buildDisabledBatchResult(personIds.length);
    }

    const uniquePersonIds = [...new Set(personIds)];
    const results = await this.runBatchWithConcurrency(
      uniquePersonIds,
      async (personId) =>
        this.enrichPerson({
          workspaceId,
          personId,
          mode,
          authContext,
        }),
    );

    const summary = this.summarizeBatchResults(results);

    return {
      ...summary,
      requestedCount: personIds.length,
      skippedCount:
        summary.skippedCount + (personIds.length - uniquePersonIds.length),
    };
  }

  async enrichCompany({
    workspaceId,
    companyId,
    authContext = buildSystemAuthContext(workspaceId),
  }: {
    workspaceId: string;
    companyId: string;
    authContext?: WorkspaceAuthContext;
  }): Promise<ApolloEnrichmentResult> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return 'disabled';
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const rolePermissionConfig =
          this.resolveRolePermissionConfig(authContext);
        const companyRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            CompanyWorkspaceEntity,
            rolePermissionConfig,
          );
        const company = await companyRepository.findOne({
          where: { id: companyId },
        });

        if (!isDefined(company)) {
          return 'not-found';
        }

        const matchInput =
          this.apolloEnrichmentMapperService.buildOrganizationMatchInput(
            company,
          );

        if (!isDefined(matchInput)) {
          return 'skipped';
        }

        const apolloResponse =
          await this.apolloClientService.enrichOrganization(matchInput);
        const mappedCompany =
          this.apolloEnrichmentMapperService.mapApolloOrganization(
            apolloResponse.organization,
          );

        if (!isDefined(mappedCompany)) {
          return 'not-matched';
        }

        const didUpdate = await this.fillEmptyCompanyFields({
          companyRepository,
          company,
          mappedCompany,
        });

        return didUpdate ? 'updated' : 'skipped';
      },
      authContext,
    );
  }

  async enrichCompanies({
    workspaceId,
    companyIds,
    authContext,
  }: {
    workspaceId: string;
    companyIds: string[];
    authContext: WorkspaceAuthContext;
  }): Promise<ApolloEnrichmentBatchResult> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return this.buildDisabledBatchResult(companyIds.length);
    }

    const results = await this.runBatchWithConcurrency(
      companyIds,
      async (companyId) =>
        this.enrichCompany({
          workspaceId,
          companyId,
          authContext,
        }),
    );

    return this.summarizeBatchResults(results);
  }

  async findBackfillCandidatePersonIds({
    workspaceId,
    limit,
    requireBackfillEnabled = true,
  }: {
    workspaceId: string;
    limit: number;
    requireBackfillEnabled?: boolean;
  }): Promise<string[]> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return [];
    }

    if (
      requireBackfillEnabled &&
      !this.twentyConfigService.get('APOLLO_ENRICHMENT_BACKFILL_ENABLED')
    ) {
      return [];
    }

    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            PersonWorkspaceEntity,
            {
              shouldBypassPermissionChecks: true,
            },
          );
        const scanLimit = Math.max(limit * 5, limit);
        const people = await personRepository.find({
          order: {
            createdAt: 'DESC',
          },
          take: scanLimit,
        });

        return people
          .filter((person) =>
            this.apolloEnrichmentMapperService.shouldEnrichPerson(person),
          )
          .filter(
            (person) =>
              !this.wasBackfillAttemptedRecently(workspaceId, person.id),
          )
          .slice(0, limit)
          .map((person) => person.id);
      },
      authContext,
    );
  }

  markBackfillAttempted({
    workspaceId,
    personId,
  }: {
    workspaceId: string;
    personId: string;
  }): void {
    this.backfillAttemptedAtByPersonKey.set(
      this.buildBackfillAttemptKey(workspaceId, personId),
      Date.now(),
    );
  }

  private async findOrCreateCompanyFromApolloOrganization({
    workspaceId,
    apolloOrganization,
    rolePermissionConfig,
  }: {
    workspaceId: string;
    apolloOrganization: ApolloOrganization | null | undefined;
    rolePermissionConfig: RolePermissionConfig | undefined;
  }): Promise<string | undefined> {
    const mappedCompany =
      await this.mapAndMaybeEnrichApolloOrganization(apolloOrganization);

    if (!isDefined(mappedCompany)) {
      return undefined;
    }

    const companyRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        CompanyWorkspaceEntity,
        rolePermissionConfig,
      );

    const existingCompany =
      (await this.findCompanyByDomain(companyRepository, mappedCompany)) ??
      (await this.findCompanyByName(companyRepository, mappedCompany));

    if (isDefined(existingCompany)) {
      await this.fillEmptyCompanyFields({
        companyRepository,
        company: existingCompany,
        mappedCompany,
      });

      return existingCompany.id;
    }

    const company = await this.createCompany({
      companyRepository,
      mappedCompany,
    });

    return company.id;
  }

  private async mapAndMaybeEnrichApolloOrganization(
    apolloOrganization: ApolloOrganization | null | undefined,
  ): Promise<ApolloCompanyMappedFields | undefined> {
    const mappedCompany =
      this.apolloEnrichmentMapperService.mapApolloOrganization(
        apolloOrganization,
      );

    if (!isDefined(mappedCompany)) {
      return undefined;
    }

    if (hasText(mappedCompany.domain) && hasText(mappedCompany.name)) {
      return mappedCompany;
    }

    try {
      const organizationResponse =
        await this.apolloClientService.enrichOrganization({
          ...(hasText(mappedCompany.domain)
            ? { domain: mappedCompany.domain }
            : {}),
          ...(hasText(mappedCompany.linkedinLink?.primaryLinkUrl)
            ? { linkedinUrl: mappedCompany.linkedinLink.primaryLinkUrl }
            : {}),
          ...(hasText(mappedCompany.name) ? { name: mappedCompany.name } : {}),
        });

      const enrichedCompany =
        this.apolloEnrichmentMapperService.mapApolloOrganization(
          organizationResponse.organization,
        );

      return enrichedCompany ?? mappedCompany;
    } catch (error) {
      this.logger.warn(
        `Apollo organization enrichment failed; continuing with person enrichment: ${String(error)}`,
      );

      return mappedCompany;
    }
  }

  private async findCompanyByDomain(
    companyRepository: WorkspaceRepository<CompanyWorkspaceEntity>,
    mappedCompany: ApolloCompanyMappedFields,
  ): Promise<CompanyWorkspaceEntity | undefined> {
    if (!hasText(mappedCompany.domain)) {
      return undefined;
    }

    const companies = await companyRepository.find({
      where: {
        domainName: {
          primaryLinkUrl: ILike(`%${mappedCompany.domain}%`),
        },
      },
      withDeleted: true,
    });

    return companies.find((company) => {
      const companyDomain = this.apolloEnrichmentMapperService.cleanDomain(
        company.domainName?.primaryLinkUrl,
      );

      return companyDomain === mappedCompany.domain;
    });
  }

  private async findCompanyByName(
    companyRepository: WorkspaceRepository<CompanyWorkspaceEntity>,
    mappedCompany: ApolloCompanyMappedFields,
  ): Promise<CompanyWorkspaceEntity | undefined> {
    if (!hasText(mappedCompany.name)) {
      return undefined;
    }

    const company = await companyRepository.findOne({
      where: {
        name: ILike(mappedCompany.name),
      },
      withDeleted: true,
    });

    return company ?? undefined;
  }

  private async fillEmptyCompanyFields({
    companyRepository,
    company,
    mappedCompany,
  }: {
    companyRepository: WorkspaceRepository<CompanyWorkspaceEntity>;
    company: CompanyWorkspaceEntity;
    mappedCompany: ApolloCompanyMappedFields;
  }): Promise<boolean> {
    const companyUpdate: DeepPartial<CompanyWorkspaceEntity> = {};

    if (isDefined(company.deletedAt)) {
      companyUpdate.deletedAt = null;
    }

    if (!hasText(company.name) && hasText(mappedCompany.name)) {
      companyUpdate.name = mappedCompany.name;
    }

    if (
      !hasText(company.domainName?.primaryLinkUrl) &&
      isDefined(mappedCompany.domainName)
    ) {
      companyUpdate.domainName = mappedCompany.domainName;
    }

    if (
      !hasText(company.linkedinLink?.primaryLinkUrl) &&
      isDefined(mappedCompany.linkedinLink)
    ) {
      companyUpdate.linkedinLink = mappedCompany.linkedinLink;
    }

    if (!isDefined(company.employees) && isDefined(mappedCompany.employees)) {
      companyUpdate.employees = mappedCompany.employees;
    }

    if (!hasText(company.industry) && hasText(mappedCompany.industry)) {
      companyUpdate.industry = mappedCompany.industry;
    }

    if (
      (company.keywords?.length ?? 0) === 0 &&
      (mappedCompany.keywords?.length ?? 0) > 0
    ) {
      companyUpdate.keywords = mappedCompany.keywords;
    }

    if (
      (company.technologies?.length ?? 0) === 0 &&
      (mappedCompany.technologies?.length ?? 0) > 0
    ) {
      companyUpdate.technologies = mappedCompany.technologies;
    }

    if (
      !isDefined(company.annualRevenue) &&
      isDefined(mappedCompany.annualRevenue)
    ) {
      companyUpdate.annualRevenue = mappedCompany.annualRevenue;
    }

    if (isDefined(mappedCompany.address)) {
      if (this.isAddressEmpty(company.address)) {
        companyUpdate.address = mappedCompany.address;
      } else if (
        !hasText(company.address?.addressCountry) &&
        hasText(mappedCompany.address.addressCountry)
      ) {
        companyUpdate.address = {
          ...company.address,
          addressCountry: mappedCompany.address.addressCountry,
        };
      }
    }

    if (Object.keys(companyUpdate).length === 0) {
      return false;
    }

    await companyRepository.update(company.id, companyUpdate);

    return true;
  }

  private async createCompany({
    companyRepository,
    mappedCompany,
  }: {
    companyRepository: WorkspaceRepository<CompanyWorkspaceEntity>;
    mappedCompany: ApolloCompanyMappedFields;
  }): Promise<CompanyWorkspaceEntity> {
    const lastCompanyPosition =
      (await companyRepository.maximum('position', undefined)) ?? 0;
    const systemActor = this.buildSystemActor();
    const companyToCreate: DeepPartial<CompanyWorkspaceEntity> = {
      name: mappedCompany.name ?? mappedCompany.domain ?? 'Unknown',
      domainName: mappedCompany.domainName ?? {
        primaryLinkLabel: '',
        primaryLinkUrl: '',
        secondaryLinks: null,
      },
      linkedinLink: mappedCompany.linkedinLink ?? null,
      employees: mappedCompany.employees ?? null,
      industry: mappedCompany.industry ?? null,
      keywords: mappedCompany.keywords ?? null,
      technologies: mappedCompany.technologies ?? null,
      annualRevenue: mappedCompany.annualRevenue ?? null,
      address: mappedCompany.address,
      position: lastCompanyPosition + 1,
      createdBy: systemActor,
      updatedBy: systemActor,
    };

    return companyRepository.save(companyToCreate);
  }

  private wasBackfillAttemptedRecently(
    workspaceId: string,
    personId: string,
  ): boolean {
    const lastAttemptedAt = this.backfillAttemptedAtByPersonKey.get(
      this.buildBackfillAttemptKey(workspaceId, personId),
    );

    if (!isDefined(lastAttemptedAt)) {
      return false;
    }

    const retryCooldownMs =
      this.twentyConfigService.get('APOLLO_ENRICHMENT_RETRY_SECONDS') * 1000;

    return Date.now() - lastAttemptedAt < retryCooldownMs;
  }

  private getPhoneEnrichmentLock({
    personId,
    requestToken,
    target,
    workspaceId,
  }: {
    personId: string;
    requestToken: string;
    target: ApolloAsyncEnrichmentTarget;
    workspaceId: string;
  }): ApolloPhoneEnrichmentLock {
    return {
      key:
        target === 'phone'
          ? `${APOLLO_PHONE_ENRICHMENT_LOCK_KEY_PREFIX}:${workspaceId}:${personId}`
          : `${APOLLO_PHONE_ENRICHMENT_LOCK_KEY_PREFIX}:email:${workspaceId}:${personId}`,
      target,
      token: requestToken,
    };
  }

  private async persistApolloPhoneIfStillMissing({
    apolloPerson,
    beforePhoneWrite,
    expectedMatchFingerprint,
    personId,
    personRepository,
  }: {
    apolloPerson: ApolloPerson;
    beforePhoneWrite?: () => Promise<boolean>;
    expectedMatchFingerprint?: string;
    personId: string;
    personRepository: WorkspaceRepository<PersonWorkspaceEntity>;
  }): Promise<ApolloPhonePersistenceOutcome> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    return workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const committedPerson = await personRepository.findOne(
        {
          where: { id: personId },
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(committedPerson)) {
        return 'not-found';
      }

      if (hasText(committedPerson.phones?.primaryPhoneNumber)) {
        return 'already-present';
      }

      if (isDefined(beforePhoneWrite) && !(await beforePhoneWrite())) {
        return 'ownership-lost';
      }

      if (hasText(expectedMatchFingerprint)) {
        const committedMatchInput =
          this.apolloEnrichmentMapperService.buildPersonMatchInput(
            committedPerson,
          );

        if (
          !isDefined(committedMatchInput) ||
          this.buildPersonMatchFingerprint(committedMatchInput) !==
            expectedMatchFingerprint
        ) {
          return 'identity-changed';
        }
      }

      const phoneUpdate =
        this.apolloEnrichmentMapperService.mapApolloPersonPhoneToTwentyUpdate({
          person: committedPerson,
          apolloPerson,
        });

      if (Object.keys(phoneUpdate).length === 0) {
        return 'missing';
      }

      await personRepository.update(
        personId,
        phoneUpdate,
        workspaceTransactionManager,
      );

      return 'updated';
    });
  }

  private async persistApolloEmailIfAllowed({
    apolloPerson,
    beforeEmailWrite,
    expectedMatchFingerprint,
    personId,
    personRepository,
  }: {
    apolloPerson: ApolloPerson;
    beforeEmailWrite?: () => Promise<boolean>;
    expectedMatchFingerprint?: string;
    personId: string;
    personRepository: WorkspaceRepository<PersonWorkspaceEntity>;
  }): Promise<ApolloPhonePersistenceOutcome> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    return workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const committedPerson = await personRepository.findOne(
        {
          where: { id: personId },
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!isDefined(committedPerson)) {
        return 'not-found';
      }

      if (isDefined(beforeEmailWrite) && !(await beforeEmailWrite())) {
        return 'ownership-lost';
      }

      if (hasText(expectedMatchFingerprint)) {
        const committedMatchInput =
          this.apolloEnrichmentMapperService.buildPersonMatchInput(
            committedPerson,
          );

        if (
          !isDefined(committedMatchInput) ||
          this.buildPersonMatchFingerprint(committedMatchInput) !==
            expectedMatchFingerprint
        ) {
          return 'identity-changed';
        }
      }

      const emailUpdate =
        this.apolloEnrichmentMapperService.mapApolloPersonEmailToTwentyUpdate({
          person: committedPerson,
          apolloPerson,
        });

      if (Object.keys(emailUpdate).length === 0) {
        return hasText(committedPerson.emails?.primaryEmail)
          ? 'already-present'
          : 'missing';
      }

      await personRepository.update(
        personId,
        emailUpdate,
        workspaceTransactionManager,
      );

      return 'updated';
    });
  }

  private async wakeSequenceApolloWaiters({
    authContext,
    personId,
    phoneRequestLock,
    retryWithNewIdentity,
    webhookProcessingLock,
    workspaceId,
  }: {
    authContext: WorkspaceAuthContext;
    personId: string;
    phoneRequestLock: ApolloPhoneEnrichmentLock;
    retryWithNewIdentity: boolean;
    webhookProcessingLock: ApolloPhoneEnrichmentLock;
    workspaceId: string;
  }): Promise<boolean> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const enrollmentRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceEnrollmentWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        return workspaceDataSource.transaction(async (transactionManager) => {
          const workspaceTransactionManager =
            transactionManager as WorkspaceEntityManager;
          const criteria = {
            personId,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
          };

          // Acquire the potentially blocking database locks first, then fence
          // the write with both exact Redis tokens. A handler whose processing
          // lease expired while waiting cannot wake a newer generation.
          await enrollmentRepository.find(
            {
              where: criteria,
              select: ['id'],
              lock: { mode: 'pessimistic_write' },
            },
            workspaceTransactionManager,
          );

          if (
            !(await this.confirmPhoneWebhookProcessingOwnership({
              phoneRequestLock,
              webhookProcessingLock,
            }))
          ) {
            return false;
          }

          await enrollmentRepository.update(
            criteria,
            retryWithNewIdentity
              ? {
                  waitingOn: SEQUENCE_WAITING_ON.DELAY,
                  nextActionAt: new Date(),
                }
              : {
                  nextActionAt: new Date(),
                },
            workspaceTransactionManager,
          );

          return true;
        });
      },
      authContext,
    );
  }

  private async resolvePhoneEnrichmentRequest({
    authContext,
    phoneRequestLock,
    personId,
    requestOwnershipConfirmed,
    retryWithNewIdentity = false,
    webhookProcessingLock,
    workspaceId,
  }: {
    authContext: WorkspaceAuthContext;
    phoneRequestLock: ApolloPhoneEnrichmentLock;
    personId: string;
    requestOwnershipConfirmed: boolean;
    retryWithNewIdentity?: boolean;
    webhookProcessingLock: ApolloPhoneEnrichmentLock;
    workspaceId: string;
  }): Promise<void> {
    // Keep the exact-token lock while moving the matching provider-started
    // cohort due. A delayed webhook cannot wake a newer request generation.
    if (requestOwnershipConfirmed && phoneRequestLock.target === 'phone') {
      const stillOwnsWebhook = await this.wakeSequenceApolloWaiters({
        authContext,
        personId,
        phoneRequestLock,
        retryWithNewIdentity,
        webhookProcessingLock,
        workspaceId,
      });

      if (!stillOwnsWebhook) {
        return;
      }
    }

    if (
      requestOwnershipConfirmed &&
      phoneRequestLock.target === 'email' &&
      !(await this.confirmPhoneWebhookProcessingOwnership({
        phoneRequestLock,
        webhookProcessingLock,
      }))
    ) {
      return;
    }

    await this.releasePhoneEnrichmentLock(phoneRequestLock, {
      throwOnFailure: requestOwnershipConfirmed,
    });
  }

  private async confirmPhoneEnrichmentLockOwnership(
    lock: ApolloPhoneEnrichmentLock | undefined,
  ): Promise<boolean> {
    if (!isDefined(lock)) {
      return false;
    }

    try {
      return await this.cacheStorageService.renewLockWithToken(
        lock.key,
        lock.token,
        APOLLO_PHONE_WEBHOOK_TOKEN_TTL_MS,
      );
    } catch (error) {
      throw new ApolloEnrichmentError(
        `Apollo asynchronous enrichment completion could not confirm its request lease: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  private async tryAcquirePhoneEnrichmentLock({
    personId,
    requestToken,
    target,
    workspaceId,
  }: {
    personId: string;
    requestToken: string;
    target: ApolloAsyncEnrichmentTarget;
    workspaceId: string;
  }): Promise<ApolloPhoneEnrichmentLock | null> {
    const lock = this.getPhoneEnrichmentLock({
      personId,
      requestToken,
      target,
      workspaceId,
    });

    try {
      const acquired = await this.cacheStorageService.acquireLockWithToken(
        lock.key,
        lock.token,
        APOLLO_PHONE_PRE_PROVIDER_LOCK_TTL_MS,
      );

      return acquired ? lock : null;
    } catch (error) {
      throw new ApolloEnrichmentError(
        `Apollo asynchronous enrichment is temporarily unavailable because request coordination failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  private async acquirePhoneWebhookProcessingLock(
    requestLock: ApolloPhoneEnrichmentLock,
  ): Promise<ApolloPhoneEnrichmentLock> {
    const processingLock = {
      key: `${requestLock.key}:webhook:${requestLock.token}`,
      target: requestLock.target,
      token: randomUUID(),
    };

    try {
      const acquired = await this.cacheStorageService.acquireLockWithToken(
        processingLock.key,
        processingLock.token,
        APOLLO_PHONE_WEBHOOK_PROCESSING_LOCK_TTL_MS,
      );

      if (!acquired) {
        throw new ApolloEnrichmentError(
          'Apollo enrichment webhook processing is already in progress',
          true,
        );
      }

      return processingLock;
    } catch (error) {
      if (error instanceof ApolloEnrichmentError) {
        throw error;
      }

      throw new ApolloEnrichmentError(
        `Apollo enrichment webhook coordination failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  private async confirmPhoneWebhookProcessingOwnership({
    phoneRequestLock,
    webhookProcessingLock,
  }: {
    phoneRequestLock: ApolloPhoneEnrichmentLock;
    webhookProcessingLock: ApolloPhoneEnrichmentLock;
  }): Promise<boolean> {
    try {
      const stillOwnsProcessing =
        await this.cacheStorageService.renewLockWithToken(
          webhookProcessingLock.key,
          webhookProcessingLock.token,
          APOLLO_PHONE_WEBHOOK_PROCESSING_LOCK_TTL_MS,
        );

      if (!stillOwnsProcessing) {
        return false;
      }

      return this.confirmPhoneEnrichmentLockOwnership(phoneRequestLock);
    } catch (error) {
      if (error instanceof ApolloEnrichmentError) {
        throw error;
      }

      throw new ApolloEnrichmentError(
        `Apollo enrichment webhook ownership could not be confirmed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  private async releasePhoneWebhookProcessingLock(
    lock: ApolloPhoneEnrichmentLock | undefined,
  ): Promise<void> {
    if (!isDefined(lock)) {
      return;
    }

    try {
      await this.cacheStorageService.releaseLockWithToken(lock.key, lock.token);
    } catch (error) {
      // This lock only serializes duplicate webhook deliveries and has a short
      // TTL. The exact request lease remains the source of lifecycle truth.
      this.logger.warn(
        `Could not release Apollo webhook-processing lock ${lock.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async renewPhoneEnrichmentLock(
    lock: ApolloPhoneEnrichmentLock | undefined,
  ): Promise<void> {
    if (!isDefined(lock)) {
      return;
    }

    try {
      const renewed = await this.cacheStorageService.renewLockWithToken(
        lock.key,
        lock.token,
        APOLLO_PHONE_WEBHOOK_TOKEN_TTL_MS,
      );

      if (!renewed) {
        throw new Error('the request lease is no longer owned');
      }
    } catch (error) {
      throw new ApolloEnrichmentProviderNotStartedError(
        `Apollo asynchronous enrichment is temporarily unavailable because its request lease could not be renewed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async releasePhoneEnrichmentLock(
    lock: ApolloPhoneEnrichmentLock | undefined,
    options: { throwOnFailure?: boolean } = {},
  ): Promise<boolean> {
    if (!isDefined(lock)) {
      return false;
    }

    try {
      // Bound an acknowledgement-lost delete or cache outage to the short
      // pre-provider lease. Webhook completion keeps the long exact-token
      // lease until its database transition has committed, so redelivery can
      // safely retry a failed wake-up.
      const shortened = await this.cacheStorageService.renewLockWithToken(
        lock.key,
        lock.token,
        APOLLO_PHONE_PRE_PROVIDER_LOCK_TTL_MS,
      );

      if (!shortened) {
        if (options.throwOnFailure) {
          throw new Error('the request lease is no longer owned');
        }

        return false;
      }

      const released = await this.cacheStorageService.releaseLockWithToken(
        lock.key,
        lock.token,
      );

      if (!released && options.throwOnFailure) {
        throw new Error('the request lease could not be released');
      }

      return released;
    } catch (error) {
      if (options.throwOnFailure) {
        throw new ApolloEnrichmentError(
          `Apollo asynchronous enrichment completion could not release its request lease: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }

      this.logger.warn(
        `Could not release Apollo asynchronous enrichment lock ${lock.key}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  private shouldEnrichPersonForMode(
    person: PersonWorkspaceEntity,
    mode: ApolloPersonEnrichmentMode,
  ): boolean {
    switch (mode) {
      case 'general':
        return this.apolloEnrichmentMapperService.shouldEnrichPersonGeneral(
          person,
        );
      case 'phone':
        return this.apolloEnrichmentMapperService.shouldEnrichPersonPhone(
          person,
        );
      case 'automatic':
        return this.apolloEnrichmentMapperService.shouldEnrichPerson(person);
    }
  }

  private async buildPersonMatchInputWithCompanyContext({
    person,
    rolePermissionConfig,
    workspaceId,
  }: {
    person: PersonWorkspaceEntity;
    rolePermissionConfig: RolePermissionConfig | undefined;
    workspaceId: string;
  }): Promise<ApolloPersonMatchInput | undefined> {
    const matchInput =
      this.apolloEnrichmentMapperService.buildPersonMatchInput(person);

    if (!isDefined(matchInput) || !hasText(person.companyId)) {
      return matchInput;
    }

    let company: CompanyWorkspaceEntity | null;

    try {
      const companyRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          CompanyWorkspaceEntity,
          rolePermissionConfig,
        );

      company = await companyRepository.findOne({
        where: { id: person.companyId },
      });
    } catch (error) {
      this.logger.warn(
        `Could not add company context to Apollo person match for ${person.id}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return matchInput;
    }

    if (!isDefined(company)) {
      return matchInput;
    }

    const organizationDomain = this.apolloEnrichmentMapperService.cleanDomain(
      company.domainName?.primaryLinkUrl,
    );
    const organizationName = company.name?.trim();

    return {
      ...matchInput,
      ...(hasText(organizationDomain) ? { organizationDomain } : {}),
      ...(hasText(organizationName) ? { organizationName } : {}),
    };
  }

  private async enqueuePhoneEnrichmentPoll({
    matchFingerprint,
    personId,
    requestId,
    requestToken,
    target,
    workspaceId,
  }: {
    matchFingerprint: string;
    personId: string;
    requestId: string;
    requestToken: string;
    target: ApolloAsyncEnrichmentTarget;
    workspaceId: string;
  }): Promise<void> {
    await this.messageQueueService.add(
      APOLLO_PHONE_ENRICHMENT_POLL_JOB_NAME,
      {
        matchFingerprint,
        personId,
        requestId,
        requestToken,
        target,
        workspaceId,
      },
      {
        backoff: {
          type: 'fixed',
          delay: APOLLO_PHONE_ENRICHMENT_POLL_INTERVAL_MS,
        },
        delay: APOLLO_PHONE_ENRICHMENT_POLL_INTERVAL_MS,
        id:
          target === 'phone'
            ? `${APOLLO_PHONE_ENRICHMENT_POLL_JOB_ID_PREFIX}:${workspaceId}:${personId}:${requestToken}`
            : `${APOLLO_PHONE_ENRICHMENT_POLL_JOB_ID_PREFIX}:email:${workspaceId}:${personId}:${requestToken}`,
        retryLimit: APOLLO_PHONE_ENRICHMENT_POLL_RETRY_LIMIT,
      },
    );
  }

  private normalizeApolloPhoneRequestId(
    requestId: number | string | null | undefined,
  ): string | undefined {
    if (!isDefined(requestId)) {
      return undefined;
    }

    const normalizedRequestId = String(requestId).trim();

    return hasText(normalizedRequestId) ? normalizedRequestId : undefined;
  }

  private getAsyncEnrichmentTarget(
    options: ApolloPersonEnrichmentOptions,
  ): ApolloAsyncEnrichmentTarget | undefined {
    if (options.runWaterfallEmail) {
      return 'email';
    }

    if (options.runWaterfallPhone || options.revealPhoneNumber) {
      return 'phone';
    }

    return undefined;
  }

  private getPersonEnrichmentOptions({
    matchFingerprint,
    mode,
    personId,
    requestToken,
    workspaceId,
  }: {
    matchFingerprint: string;
    mode: ApolloPersonEnrichmentMode;
    personId: string;
    requestToken: string;
    workspaceId: string;
  }): ApolloPersonEnrichmentOptions {
    if (mode === 'phone') {
      return {
        revealPersonalEmails: false,
        revealPhoneNumber: false,
        runWaterfallEmail: false,
        runWaterfallPhone: true,
        webhookUrl: this.buildPhoneEnrichmentWebhookUrl({
          matchFingerprint,
          personId,
          requestToken,
          target: 'phone',
          workspaceId,
        }),
      };
    }

    if (mode === 'general') {
      return {
        revealPersonalEmails: false,
        revealPhoneNumber: false,
        runWaterfallEmail: true,
        runWaterfallPhone: true,
        webhookUrl: this.buildPhoneEnrichmentWebhookUrl({
          matchFingerprint,
          personId,
          requestToken,
          target: 'email',
          workspaceId,
        }),
      };
    }

    const revealPhoneNumber =
      this.twentyConfigService.get('APOLLO_REVEAL_PHONE_NUMBER') ?? false;

    return {
      revealPersonalEmails:
        this.twentyConfigService.get('APOLLO_REVEAL_PERSONAL_EMAILS') ?? false,
      revealPhoneNumber,
      runWaterfallEmail: false,
      runWaterfallPhone: false,
      ...(revealPhoneNumber
        ? {
            webhookUrl: this.buildPhoneEnrichmentWebhookUrl({
              matchFingerprint,
              personId,
              requestToken,
              target: 'phone',
              workspaceId,
            }),
          }
        : {}),
    };
  }

  private buildPhoneEnrichmentWebhookUrl({
    matchFingerprint,
    personId,
    requestToken,
    target,
    workspaceId,
  }: {
    matchFingerprint: string;
    personId: string;
    requestToken: string;
    target: ApolloAsyncEnrichmentTarget;
    workspaceId: string;
  }): string {
    const webhookBaseUrl =
      this.twentyConfigService.get(
        'APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL',
      ) ?? this.twentyConfigService.get('SERVER_URL');
    const serverUrl = new URL(webhookBaseUrl);

    if (serverUrl.protocol !== 'https:') {
      throw new ApolloEnrichmentError(
        'Apollo asynchronous enrichment requires APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL or SERVER_URL to use public HTTPS',
        false,
      );
    }

    const token = this.buildPhoneWebhookToken({
      matchFingerprint,
      personId,
      requestToken,
      target,
      workspaceId,
    });

    return new URL(
      `/webhooks/apollo/enrichment/${token}`,
      serverUrl,
    ).toString();
  }

  private buildPhoneWebhookToken({
    matchFingerprint,
    personId,
    requestToken,
    target,
    workspaceId,
  }: {
    matchFingerprint: string;
    personId: string;
    requestToken: string;
    target: ApolloAsyncEnrichmentTarget;
    workspaceId: string;
  }): string {
    const tokenPayload: ApolloPhoneWebhookTokenPayload = {
      expiresAt: Date.now() + APOLLO_PHONE_WEBHOOK_TOKEN_TTL_MS,
      matchFingerprint,
      personId,
      requestToken,
      target,
      workspaceId,
    };
    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString(
      'base64url',
    );
    const signature = this.signPhoneWebhookPayload(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  private verifyPhoneWebhookToken(
    token: string,
  ): ApolloPhoneWebhookTokenPayload | undefined {
    const [encodedPayload, signature, ...unexpectedTokenParts] =
      token.split('.');

    if (
      !hasText(encodedPayload) ||
      !hasText(signature) ||
      unexpectedTokenParts.length > 0
    ) {
      return undefined;
    }

    const expectedSignature = this.signPhoneWebhookPayload(encodedPayload);
    const signatureBuffer = Buffer.from(signature);
    const expectedSignatureBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedSignatureBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
    ) {
      return undefined;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<ApolloPhoneWebhookTokenPayload>;

      if (
        !hasText(payload.workspaceId) ||
        !hasText(payload.personId) ||
        typeof payload.expiresAt !== 'number' ||
        payload.expiresAt < Date.now()
      ) {
        return undefined;
      }

      return {
        expiresAt: payload.expiresAt,
        ...(hasText(payload.matchFingerprint)
          ? { matchFingerprint: payload.matchFingerprint }
          : {}),
        personId: payload.personId,
        ...(hasText(payload.requestToken)
          ? { requestToken: payload.requestToken }
          : {}),
        target: payload.target === 'email' ? 'email' : 'phone',
        workspaceId: payload.workspaceId,
      };
    } catch {
      return undefined;
    }
  }

  private signPhoneWebhookPayload(encodedPayload: string): string {
    return createHmac('sha256', this.twentyConfigService.get('APP_SECRET'))
      .update(encodedPayload)
      .digest('base64url');
  }

  private buildPersonMatchFingerprint(
    matchInput: ApolloPersonMatchInput,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          email: matchInput.email ?? null,
          firstName: matchInput.firstName ?? null,
          lastName: matchInput.lastName ?? null,
          linkedinUrl: matchInput.linkedinUrl ?? null,
        }),
      )
      .digest('base64url');
  }

  private resolveRolePermissionConfig(
    authContext: WorkspaceAuthContext,
  ): RolePermissionConfig | undefined {
    if (authContext.type === 'system') {
      return { shouldBypassPermissionChecks: true };
    }

    const workspaceContext = getWorkspaceContext();

    return (
      resolveRolePermissionConfig({
        authContext: workspaceContext.authContext,
        userWorkspaceRoleMap: workspaceContext.userWorkspaceRoleMap,
        apiKeyRoleMap: workspaceContext.apiKeyRoleMap,
      }) ?? undefined
    );
  }

  private summarizeBatchResults(
    results: PromiseSettledResult<ApolloEnrichmentResult>[],
  ): ApolloEnrichmentBatchResult {
    const summary: ApolloEnrichmentBatchResult = {
      requestedCount: results.length,
      updatedCount: 0,
      pendingCount: 0,
      skippedCount: 0,
      notMatchedCount: 0,
      notFoundCount: 0,
      failedCount: 0,
      disabled: false,
    };

    for (const result of results) {
      if (result.status === 'rejected') {
        summary.failedCount += 1;
        this.logger.warn(`Apollo enrichment failed: ${String(result.reason)}`);
        continue;
      }

      switch (result.value) {
        case 'updated':
          summary.updatedCount += 1;
          break;
        case 'updated-pending':
          summary.updatedCount += 1;
          summary.pendingCount += 1;
          break;
        case 'pending':
          summary.pendingCount += 1;
          break;
        case 'skipped':
        case 'identity-changed':
          summary.skippedCount += 1;
          break;
        case 'not-matched':
          summary.notMatchedCount += 1;
          break;
        case 'not-found':
          summary.notFoundCount += 1;
          break;
        case 'disabled':
          summary.disabled = true;
          break;
      }
    }

    return summary;
  }

  private async runBatchWithConcurrency<TItem>(
    items: TItem[],
    callback: (item: TItem) => Promise<ApolloEnrichmentResult>,
  ): Promise<PromiseSettledResult<ApolloEnrichmentResult>[]> {
    const results: PromiseSettledResult<ApolloEnrichmentResult>[] = new Array(
      items.length,
    );
    let nextItemIndex = 0;

    const worker = async () => {
      while (nextItemIndex < items.length) {
        const itemIndex = nextItemIndex;

        nextItemIndex += 1;

        try {
          results[itemIndex] = {
            status: 'fulfilled',
            value: await callback(items[itemIndex]),
          };
        } catch (reason) {
          results[itemIndex] = {
            status: 'rejected',
            reason,
          };
        }
      }
    };

    await Promise.all(
      Array.from(
        {
          length: Math.min(APOLLO_ENRICHMENT_BATCH_CONCURRENCY, items.length),
        },
        worker,
      ),
    );

    return results;
  }

  private buildDisabledBatchResult(
    requestedCount: number,
  ): ApolloEnrichmentBatchResult {
    return {
      requestedCount,
      updatedCount: 0,
      pendingCount: 0,
      skippedCount: 0,
      notMatchedCount: 0,
      notFoundCount: 0,
      failedCount: 0,
      disabled: true,
    };
  }

  private isAddressEmpty(
    address: CompanyWorkspaceEntity['address'] | null | undefined,
  ): boolean {
    return (
      !hasText(address?.addressStreet1) &&
      !hasText(address?.addressStreet2) &&
      !hasText(address?.addressCity) &&
      !hasText(address?.addressState) &&
      !hasText(address?.addressZipCode) &&
      !hasText(address?.addressCountry) &&
      !address?.addressLat &&
      !address?.addressLng
    );
  }

  private buildBackfillAttemptKey(workspaceId: string, personId: string) {
    return `${workspaceId}:${personId}`;
  }

  private buildSystemActor(): ActorMetadata {
    return {
      source: FieldActorSource.SYSTEM,
      workspaceMemberId: null,
      name: 'System',
      context: {},
    };
  }
}
