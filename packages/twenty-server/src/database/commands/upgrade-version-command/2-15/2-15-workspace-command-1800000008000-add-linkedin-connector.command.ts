import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const LINKEDIN_ACTION_OBJECT_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.linkedinAction.universalIdentifier,
];

const LINKEDIN_ACTION_FIELD_UNIVERSAL_IDENTIFIERS = [
  ...Object.values(STANDARD_OBJECTS.linkedinAction.fields).map(
    ({ universalIdentifier }) => universalIdentifier,
  ),
  STANDARD_OBJECTS.person.fields.linkedinConnectionState.universalIdentifier,
  STANDARD_OBJECTS.person.fields.linkedinActions.universalIdentifier,
];

const LINKEDIN_ACTION_INDEX_UNIVERSAL_IDENTIFIERS = Object.values(
  STANDARD_OBJECTS.linkedinAction.indexes,
).map(({ universalIdentifier }) => universalIdentifier);

const SELECT_FIELD_UNIVERSAL_IDENTIFIERS_TO_UPDATE = [
  STANDARD_OBJECTS.sequenceStep.fields.type.universalIdentifier,
  STANDARD_OBJECTS.sequenceEnrollment.fields.waitingOn.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000008000)
@Command({
  name: 'upgrade:2-15:add-linkedin-connector',
  description: 'Install LinkedIn actions and sequence step metadata',
})
export class AddLinkedinConnectorCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
    const { flatObjectMetadataMaps, flatFieldMetadataMaps, flatIndexMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
        'flatIndexMaps',
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
    const allFlatEntityOperationByMetadataName = {
      objectMetadata: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatObjectMetadata>({
            standardFlatEntityMaps:
              standardAllFlatEntityMaps.flatObjectMetadataMaps,
            existingFlatEntityMaps: flatObjectMetadataMaps,
            universalIdentifiers:
              LINKEDIN_ACTION_OBJECT_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
      fieldMetadata: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatFieldMetadata>({
            standardFlatEntityMaps:
              standardAllFlatEntityMaps.flatFieldMetadataMaps,
            existingFlatEntityMaps: flatFieldMetadataMaps,
            universalIdentifiers:
              LINKEDIN_ACTION_FIELD_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: selectFieldsToUpdate,
      },
      index: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatIndexMetadata>({
            standardFlatEntityMaps: standardAllFlatEntityMaps.flatIndexMaps,
            existingFlatEntityMaps: flatIndexMaps,
            universalIdentifiers:
              LINKEDIN_ACTION_INDEX_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
    };
    const operationCount = Object.values(
      allFlatEntityOperationByMetadataName,
    ).reduce(
      (count, operations) =>
        count +
        operations.flatEntityToCreate.length +
        operations.flatEntityToUpdate.length,
      0,
    );

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would apply ${operationCount} LinkedIn connector metadata operations for workspace ${workspaceId}`,
      );

      return;
    }

    if (operationCount === 0) {
      this.logger.log(
        `LinkedIn connector metadata is already installed for workspace ${workspaceId}`,
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
          allFlatEntityOperationByMetadataName,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to install LinkedIn connector metadata for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Applied ${operationCount} LinkedIn connector metadata operations for workspace ${workspaceId}`,
    );
  }
}
