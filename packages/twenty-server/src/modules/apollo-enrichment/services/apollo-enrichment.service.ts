import { Injectable, Logger } from '@nestjs/common';

import { FieldActorSource, type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type DeepPartial, ILike } from 'typeorm';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';
import {
  type ApolloCompanyMappedFields,
  ApolloEnrichmentMapperService,
  hasText,
} from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { type ApolloOrganization } from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type ApolloEnrichmentResult =
  | 'disabled'
  | 'skipped'
  | 'not-found'
  | 'not-matched'
  | 'updated';

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
  }: {
    workspaceId: string;
    personId: string;
  }): Promise<ApolloEnrichmentResult> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return 'disabled';
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

        const person = await personRepository.findOne({
          where: { id: personId },
        });

        if (!isDefined(person)) {
          return 'not-found';
        }

        if (!this.apolloEnrichmentMapperService.shouldEnrichPerson(person)) {
          return 'skipped';
        }

        const matchInput =
          this.apolloEnrichmentMapperService.buildPersonMatchInput(person);

        if (!isDefined(matchInput)) {
          return 'skipped';
        }

        const apolloResponse =
          await this.apolloClientService.enrichPerson(matchInput);
        const apolloPerson = apolloResponse.person;

        if (!isDefined(apolloPerson)) {
          return 'not-matched';
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
            });
        const personUpdate =
          this.apolloEnrichmentMapperService.mapApolloPersonToTwentyUpdate({
            person,
            apolloPerson,
            companyId,
          });

        if (Object.keys(personUpdate).length === 0) {
          return 'skipped';
        }

        await personRepository.update(person.id, personUpdate);

        return 'updated';
      },
      authContext,
    );
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
  }: {
    workspaceId: string;
    apolloOrganization: ApolloOrganization | null | undefined;
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
        {
          shouldBypassPermissionChecks: true,
        },
      );

    const existingCompany =
      (await this.findCompanyByDomain(companyRepository, mappedCompany)) ??
      (await this.findCompanyByName(companyRepository, mappedCompany));

    if (isDefined(existingCompany)) {
      await this.restoreAndFillEmptyCompanyFields({
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

  private async restoreAndFillEmptyCompanyFields({
    companyRepository,
    company,
    mappedCompany,
  }: {
    companyRepository: WorkspaceRepository<CompanyWorkspaceEntity>;
    company: CompanyWorkspaceEntity;
    mappedCompany: ApolloCompanyMappedFields;
  }): Promise<void> {
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

    if (Object.keys(companyUpdate).length === 0) {
      return;
    }

    await companyRepository.update(company.id, companyUpdate);
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
