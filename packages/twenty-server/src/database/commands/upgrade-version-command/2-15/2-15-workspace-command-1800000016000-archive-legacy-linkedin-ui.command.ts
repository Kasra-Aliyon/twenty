import { Command } from 'nest-commander';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import {
  getLegacyLinkedinMigrationStats,
  migrateLegacyLinkedinData,
} from 'src/database/commands/upgrade-version-command/2-15/utils/migrate-legacy-linkedin-data.util';
import {
  buildUniboxLinkedinLegacyArchiveOperations,
  findUniboxLinkedinLegacyObjects,
} from 'src/database/commands/upgrade-version-command/2-15/utils/unibox-linkedin-name-collision.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

@RegisteredWorkspaceCommand('2.15.0', 1800000016000)
@Command({
  name: 'upgrade:2-15:archive-legacy-linkedin-ui',
  description:
    'Verify promoted LinkedIn data, freeze legacy backups, and remove their stale navigation items',
})
export class ArchiveLegacyLinkedinUiCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const { workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { flatNavigationMenuItemMaps, flatObjectMetadataMaps, flatViewMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatNavigationMenuItemMaps',
        'flatObjectMetadataMaps',
        'flatViewMaps',
      ]);
    const legacyObjects = findUniboxLinkedinLegacyObjects({
      flatObjectMetadataMaps,
      workspaceCustomApplicationId: workspaceCustomFlatApplication.id,
    });

    if (legacyObjects.length === 0) {
      this.logger.log(
        `No promoted legacy LinkedIn objects found for workspace ${workspaceId}`,
      );

      return;
    }

    if (!options.dryRun) {
      await migrateLegacyLinkedinData({
        dataSource: this.coreDataSource,
        legacyObjects,
        workspaceId,
      });
    }

    const migrationStats = await getLegacyLinkedinMigrationStats({
      dataSource: this.coreDataSource,
      legacyObjects,
      workspaceId,
    });
    const incompleteDatasets = migrationStats.filter(
      ({ missingCanonicalRowCount }) => missingCanonicalRowCount > 0,
    );

    if (incompleteDatasets.length > 0) {
      throw new Error(
        `Refusing to archive legacy LinkedIn UI for workspace ${workspaceId} because canonical data is incomplete: ${incompleteDatasets
          .map(
            ({ dataset, eligibleLegacyRowCount, missingCanonicalRowCount }) =>
              `${dataset} ${missingCanonicalRowCount}/${eligibleLegacyRowCount} missing`,
          )
          .join(', ')}`,
      );
    }

    const { archivedObjectMetadatas, navigationMenuItemsToDelete } =
      buildUniboxLinkedinLegacyArchiveOperations({
        flatNavigationMenuItemMaps,
        flatViewMaps,
        legacyObjects,
        now: new Date().toISOString(),
      });

    if (
      archivedObjectMetadatas.length === 0 &&
      navigationMenuItemsToDelete.length === 0
    ) {
      this.logger.log(
        `Legacy LinkedIn UI is already archived for workspace ${workspaceId}`,
      );

      return;
    }

    const verifiedRows = migrationStats.reduce(
      (count, { eligibleLegacyRowCount }) => count + eligibleLegacyRowCount,
      0,
    );

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Verified ${verifiedRows} promoted LinkedIn rows; would freeze ${archivedObjectMetadatas.length} legacy object(s) and remove ${navigationMenuItemsToDelete.length} stale navigation item(s) for workspace ${workspaceId}`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            navigationMenuItem: {
              flatEntityToCreate: [],
              flatEntityToDelete: navigationMenuItemsToDelete,
              flatEntityToUpdate: [],
            },
            objectMetadata: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: archivedObjectMetadatas,
            },
          },
          applicationUniversalIdentifier:
            workspaceCustomFlatApplication.universalIdentifier,
          isSystemBuild: true,
          workspaceId,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to archive legacy LinkedIn UI for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Verified ${verifiedRows} promoted LinkedIn rows, froze ${archivedObjectMetadatas.length} legacy object(s), and removed ${navigationMenuItemsToDelete.length} stale navigation item(s) for workspace ${workspaceId}`,
    );
  }
}
