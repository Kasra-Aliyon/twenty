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

const SELECT_FIELD_UNIVERSAL_IDENTIFIERS_TO_UPDATE = [
  STANDARD_OBJECTS.sequenceStep.fields.type.universalIdentifier,
  STANDARD_OBJECTS.linkedinAction.fields.type.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000010000)
@Command({
  name: 'upgrade:2-15:enable-linkedin-direct-messages',
  description: 'Add direct messages to LinkedIn sequence action metadata',
})
export class EnableLinkedinDirectMessagesCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
    const selectFieldsToUpdate = SELECT_FIELD_UNIVERSAL_IDENTIFIERS_TO_UPDATE.map(
      (universalIdentifier) => {
        const existingField =
          flatFieldMetadataMaps.byUniversalIdentifier[universalIdentifier];
        const standardField =
          standardAllFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
            universalIdentifier
          ];

        if (!isDefined(existingField) || !isDefined(standardField)) {
          return undefined;
        }

        if (
          JSON.stringify(existingField.options) ===
          JSON.stringify(standardField.options)
        ) {
          return undefined;
        }

        return {
          ...existingField,
          options: standardField.options,
          updatedAt: now,
        };
      },
    ).filter(isDefined);

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would update ${selectFieldsToUpdate.length} LinkedIn direct-message fields for workspace ${workspaceId}`,
      );

      return;
    }

    if (selectFieldsToUpdate.length === 0) {
      this.logger.log(
        `LinkedIn direct-message metadata is already installed for workspace ${workspaceId}`,
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
              flatEntityToUpdate: selectFieldsToUpdate,
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
        `Failed to install LinkedIn direct-message metadata for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Updated ${selectFieldsToUpdate.length} LinkedIn direct-message fields for workspace ${workspaceId}`,
    );
  }
}
