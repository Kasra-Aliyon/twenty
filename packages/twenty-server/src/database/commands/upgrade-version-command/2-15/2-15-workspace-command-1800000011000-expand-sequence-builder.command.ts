import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

@RegisteredWorkspaceCommand('2.15.0', 1800000011000)
@Command({
  name: 'upgrade:2-15:expand-sequence-builder',
  description: 'Add conditions and phone enrichment to sequence step metadata',
})
export class ExpandSequenceBuilderCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { flatFieldMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatFieldMetadataMaps',
      ]);
    const now = new Date().toISOString();
    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now,
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const universalIdentifier =
      STANDARD_OBJECTS.sequenceStep.fields.type.universalIdentifier;
    const existingField =
      flatFieldMetadataMaps.byUniversalIdentifier[universalIdentifier];
    const standardField =
      standardAllFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        universalIdentifier
      ];
    const fieldToUpdate =
      isDefined(existingField) &&
      isDefined(standardField) &&
      JSON.stringify(existingField.options) !==
        JSON.stringify(standardField.options)
        ? {
            ...existingField,
            options: standardField.options,
            updatedAt: now,
          }
        : undefined;

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would update ${isDefined(fieldToUpdate) ? 1 : 0} sequence builder fields for workspace ${workspaceId}`,
      );

      return;
    }

    if (!isDefined(fieldToUpdate)) {
      this.logger.log(
        `Expanded sequence builder metadata is already installed for workspace ${workspaceId}`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
        {
          workspaceId,
          isSystemBuild: true,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
          allFlatEntityOperationByMetadataName: {
            objectMetadata: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
            fieldMetadata: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: [fieldToUpdate],
            },
            index: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to install expanded sequence builder metadata for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Updated sequence builder metadata for workspace ${workspaceId}`,
    );
  }
}
