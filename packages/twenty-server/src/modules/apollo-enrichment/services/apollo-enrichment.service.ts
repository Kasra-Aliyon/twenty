import { Injectable, Logger } from '@nestjs/common';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { FieldActorSource, type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type DeepPartial, ILike } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';
import {
  type ApolloCompanyMappedFields,
  ApolloEnrichmentMapperService,
  hasText,
} from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import {
  type ApolloOrganization,
  type ApolloPhoneEnrichmentWebhookPayload,
  type ApolloPersonEnrichmentOptions,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type ApolloEnrichmentResult =
  | 'disabled'
  | 'skipped'
  | 'not-found'
  | 'not-matched'
  | 'updated';

export type ApolloPersonEnrichmentMode = 'automatic' | 'general' | 'phone';

export type ApolloEnrichmentBatchResult = {
  requestedCount: number;
  updatedCount: number;
  skippedCount: number;
  notMatchedCount: number;
  notFoundCount: number;
  failedCount: number;
  disabled: boolean;
};

const APOLLO_ENRICHMENT_BATCH_CONCURRENCY = 10;
const APOLLO_PHONE_WEBHOOK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type ApolloPhoneWebhookTokenPayload = {
  expiresAt: number;
  personId: string;
  workspaceId: string;
};

@Injectable()
export class ApolloEnrichmentService {
  private readonly logger = new Logger(ApolloEnrichmentService.name);
  private readonly backfillAttemptedAtByPersonKey = new Map<string, number>();

  constructor(
    private readonly apolloClientService: ApolloClientService,
    private readonly apolloEnrichmentMapperService: ApolloEnrichmentMapperService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async enrichPerson({
    workspaceId,
    personId,
    mode = 'automatic',
    authContext = buildSystemAuthContext(workspaceId),
  }: {
    workspaceId: string;
    personId: string;
    mode?: ApolloPersonEnrichmentMode;
    authContext?: WorkspaceAuthContext;
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

        const person = await personRepository.findOne({
          where: { id: personId },
        });

        if (!isDefined(person)) {
          return 'not-found';
        }

        if (!this.shouldEnrichPersonForMode(person, mode)) {
          return 'skipped';
        }

        const matchInput =
          this.apolloEnrichmentMapperService.buildPersonMatchInput(person);

        if (!isDefined(matchInput)) {
          return 'skipped';
        }

        const apolloResponse = await this.apolloClientService.enrichPerson(
          matchInput,
          this.getPersonEnrichmentOptions({
            mode,
            personId,
            workspaceId,
          }),
        );
        const apolloPerson = apolloResponse.person;

        if (!isDefined(apolloPerson)) {
          return 'not-matched';
        }

        if (mode === 'phone') {
          const phoneUpdate =
            this.apolloEnrichmentMapperService.mapApolloPersonPhoneToTwentyUpdate(
              {
                person,
                apolloPerson,
              },
            );

          if (Object.keys(phoneUpdate).length === 0) {
            return 'not-matched';
          }

          await personRepository.update(person.id, phoneUpdate);

          return 'updated';
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

        if (Object.keys(personUpdate).length === 0) {
          return 'skipped';
        }

        await personRepository.update(person.id, personUpdate);

        return 'updated';
      },
      authContext,
    );
  }

  async handlePhoneEnrichmentWebhook({
    token,
    payload,
  }: {
    token: string;
    payload: ApolloPhoneEnrichmentWebhookPayload;
  }): Promise<void> {
    const tokenPayload = this.verifyPhoneWebhookToken(token);
    const apolloPerson = payload.people?.[0];

    if (
      !isDefined(tokenPayload) ||
      payload.status !== 'success' ||
      !isDefined(apolloPerson)
    ) {
      return;
    }

    const authContext = buildSystemAuthContext(tokenPayload.workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          tokenPayload.workspaceId,
          PersonWorkspaceEntity,
          {
            shouldBypassPermissionChecks: true,
          },
        );
      const person = await personRepository.findOne({
        where: {
          id: tokenPayload.personId,
        },
      });

      if (!isDefined(person)) {
        return;
      }

      const phoneUpdate =
        this.apolloEnrichmentMapperService.mapApolloPersonPhoneToTwentyUpdate({
          person,
          apolloPerson,
        });

      if (Object.keys(phoneUpdate).length === 0) {
        return;
      }

      await personRepository.update(person.id, phoneUpdate);
    }, authContext);
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

    const results = await this.runBatchWithConcurrency(
      personIds,
      async (personId) =>
        this.enrichPerson({
          workspaceId,
          personId,
          mode,
          authContext,
        }),
    );

    return this.summarizeBatchResults(results);
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

    if (
      this.isAddressEmpty(company.address) &&
      isDefined(mappedCompany.address)
    ) {
      companyUpdate.address = mappedCompany.address;
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

  private getPersonEnrichmentOptions({
    mode,
    personId,
    workspaceId,
  }: {
    mode: ApolloPersonEnrichmentMode;
    personId: string;
    workspaceId: string;
  }): ApolloPersonEnrichmentOptions {
    if (mode === 'phone') {
      return {
        revealPersonalEmails: false,
        revealPhoneNumber: true,
        webhookUrl: this.buildPhoneEnrichmentWebhookUrl({
          personId,
          workspaceId,
        }),
      };
    }

    if (mode === 'general') {
      return {
        revealPersonalEmails:
          this.twentyConfigService.get('APOLLO_REVEAL_PERSONAL_EMAILS') ??
          false,
        revealPhoneNumber: false,
      };
    }

    const revealPhoneNumber =
      this.twentyConfigService.get('APOLLO_REVEAL_PHONE_NUMBER') ?? false;

    return {
      revealPersonalEmails:
        this.twentyConfigService.get('APOLLO_REVEAL_PERSONAL_EMAILS') ?? false,
      revealPhoneNumber,
      ...(revealPhoneNumber
        ? {
            webhookUrl: this.buildPhoneEnrichmentWebhookUrl({
              personId,
              workspaceId,
            }),
          }
        : {}),
    };
  }

  private buildPhoneEnrichmentWebhookUrl({
    personId,
    workspaceId,
  }: {
    personId: string;
    workspaceId: string;
  }): string {
    const webhookBaseUrl =
      this.twentyConfigService.get(
        'APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL',
      ) ?? this.twentyConfigService.get('SERVER_URL');
    const serverUrl = new URL(webhookBaseUrl);

    if (serverUrl.protocol !== 'https:') {
      throw new ApolloEnrichmentError(
        'Apollo phone enrichment requires APOLLO_PHONE_ENRICHMENT_WEBHOOK_BASE_URL or SERVER_URL to use public HTTPS',
        false,
      );
    }

    const tokenPayload: ApolloPhoneWebhookTokenPayload = {
      expiresAt: Date.now() + APOLLO_PHONE_WEBHOOK_TOKEN_TTL_MS,
      personId,
      workspaceId,
    };
    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString(
      'base64url',
    );
    const signature = this.signPhoneWebhookPayload(encodedPayload);

    return new URL(
      `/webhooks/apollo/enrichment/${encodedPayload}.${signature}`,
      serverUrl,
    ).toString();
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
        personId: payload.personId,
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
        case 'skipped':
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
