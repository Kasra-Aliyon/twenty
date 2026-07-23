import { Command } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { buildSequenceTasksNavigationMenuItemUpdate } from 'src/database/commands/upgrade-version-command/2-15/utils/build-sequence-tasks-navigation-menu-item-update.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_NAVIGATION_MENU_ITEMS } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-navigation-menu-item.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

@RegisteredWorkspaceCommand('2.15.0', 1800000012000)
@Command({
  name: 'upgrade:2-15:rename-sequence-tasks-navigation-item',
  description: 'Rename the default sequence task queue navigation item',
})
export class RenameSequenceTasksNavigationItemCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
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
    const { flatNavigationMenuItemMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatNavigationMenuItemMaps',
      ]);
    const navigationMenuItemUpdate =
      buildSequenceTasksNavigationMenuItemUpdate({
        existingNavigationMenuItem:
          flatNavigationMenuItemMaps.byUniversalIdentifier[
            STANDARD_NAVIGATION_MENU_ITEMS.taskQueue.universalIdentifier
          ],
        now: new Date().toISOString(),
      });

    if (!isDefined(navigationMenuItemUpdate)) {
      this.logger.log(
        `Sequence Tasks navigation item is missing, customized, or already up to date for workspace ${workspaceId}`,
      );

      return;
    }

    if (isDryRun) {
      this.logger.log(
        `[DRY RUN] Would rename the sequence task queue navigation item for workspace ${workspaceId}`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            navigationMenuItem: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: [navigationMenuItemUpdate],
            },
          },
          workspaceId,
          isSystemBuild: true,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to rename the sequence task queue navigation item:\n${JSON.stringify(validateAndBuildResult, null, 2)}`,
      );

      throw new Error(
        `Failed to rename the sequence task queue navigation item for workspace ${workspaceId}`,
      );
    }

    this.logger.log(
      `Renamed the sequence task queue navigation item for workspace ${workspaceId}`,
    );
  }
}
