import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';
import { MoreThan } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatViewField } from 'src/engine/metadata-modules/flat-view-field/types/flat-view-field.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { LinkedinConnectionMatcherService } from 'src/modules/linkedin/services/linkedin-connection-matcher.service';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';

const CONNECTION_BATCH_SIZE = 500;

const PERSON_LINKEDIN_CONNECTED_AT_FIELD_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.person.fields.linkedinConnectedAt.universalIdentifier;

const PERSON_LINKEDIN_CONNECTED_AT_VIEW_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.person.views.allPeople.viewFields.linkedinConnectedAt
    .universalIdentifier,
  STANDARD_OBJECTS.person.views.personRecordPageFields.viewFields
    .linkedinConnectedAt.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000017000)
@Command({
  name: 'upgrade:2-15:add-person-linkedin-connected-at',
  description:
    'Expose and backfill the LinkedIn connection date on Person records',
})
export class AddPersonLinkedinConnectedAtCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly linkedinConnectionMatcherService: LinkedinConnectionMatcherService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;
    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { flatObjectMetadataMaps, flatFieldMetadataMaps, flatViewFieldMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
        'flatViewFieldMaps',
      ]);

    if (
      !isDefined(
        flatObjectMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.person.universalIdentifier
        ],
      )
    ) {
      this.logger.log(
        `Person object metadata does not exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const fieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatFieldMetadata>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatFieldMetadataMaps,
        existingFlatEntityMaps: flatFieldMetadataMaps,
        universalIdentifiers: [
          PERSON_LINKEDIN_CONNECTED_AT_FIELD_UNIVERSAL_IDENTIFIER,
        ],
      });
    const viewFieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatViewField>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatViewFieldMaps,
        existingFlatEntityMaps: flatViewFieldMaps,
        universalIdentifiers:
          PERSON_LINKEDIN_CONNECTED_AT_VIEW_FIELD_UNIVERSAL_IDENTIFIERS,
      });
    const connectionCount = await this.countConnections(workspaceId);

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Creating ${fieldsToCreate.length} Person field(s), ${viewFieldsToCreate.length} Person view field(s), and backfilling from ${connectionCount} LinkedIn connection(s) for workspace ${workspaceId}`,
    );

    if (isDryRun) {
      return;
    }

    if (fieldsToCreate.length > 0 || viewFieldsToCreate.length > 0) {
      const validateAndBuildResult =
        await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
          {
            workspaceId,
            isSystemBuild: true,
            applicationUniversalIdentifier:
              twentyStandardFlatApplication.universalIdentifier,
            allFlatEntityOperationByMetadataName: {
              fieldMetadata: {
                flatEntityToCreate: fieldsToCreate,
                flatEntityToDelete: [],
                flatEntityToUpdate: [],
              },
              viewField: {
                flatEntityToCreate: viewFieldsToCreate,
                flatEntityToDelete: [],
                flatEntityToUpdate: [],
              },
            },
          },
        );

      if (validateAndBuildResult.status === 'fail') {
        throw new Error(
          `Failed to add the Person LinkedIn connection date for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
        );
      }
    }

    const processedConnectionCount =
      await this.backfillConnections(workspaceId);

    this.logger.log(
      `Added the Person LinkedIn connection date and attempted to match ${processedConnectionCount} LinkedIn connection(s) for workspace ${workspaceId}`,
    );
  }

  private async backfillConnections(workspaceId: string): Promise<number> {
    let processedCount = 0;
    let lastId: string | null = null;

    for (;;) {
      const connectionIds = await this.getConnectionIdsBatch({
        workspaceId,
        afterId: lastId,
      });

      if (connectionIds.length === 0) {
        break;
      }

      await this.linkedinConnectionMatcherService.matchConnectionsByIds({
        connectionIds,
        workspaceId,
      });

      processedCount += connectionIds.length;
      lastId = connectionIds[connectionIds.length - 1];

      if (connectionIds.length < CONNECTION_BATCH_SIZE) {
        break;
      }
    }

    return processedCount;
  }

  private async countConnections(workspaceId: string): Promise<number> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinConnectionWorkspaceEntity>(
            workspaceId,
            'linkedinConnection',
            { shouldBypassPermissionChecks: true },
          );

        return repository.count();
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async getConnectionIdsBatch({
    workspaceId,
    afterId,
  }: {
    workspaceId: string;
    afterId: string | null;
  }): Promise<string[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinConnectionWorkspaceEntity>(
            workspaceId,
            'linkedinConnection',
            { shouldBypassPermissionChecks: true },
          );
        const rows = await repository.find({
          where: afterId ? { id: MoreThan(afterId) } : {},
          order: { id: 'ASC' },
          take: CONNECTION_BATCH_SIZE,
          select: ['id'],
        });

        return rows.map(({ id }) => id);
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
