import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FeatureFlagKey } from 'twenty-shared/types';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type FlatNavigationMenuItem } from 'src/engine/metadata-modules/flat-navigation-menu-item/types/flat-navigation-menu-item.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_NAVIGATION_MENU_ITEMS } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-navigation-menu-item.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const RECORD_LIST_OBJECT_DEFINITIONS = [
  STANDARD_OBJECTS.recordListFolder,
  STANDARD_OBJECTS.recordList,
  STANDARD_OBJECTS.recordListMember,
];

const RECORD_LIST_OBJECT_UNIVERSAL_IDENTIFIERS =
  RECORD_LIST_OBJECT_DEFINITIONS.map(
    (objectDefinition) => objectDefinition.universalIdentifier,
  );

const RECORD_LIST_FIELD_UNIVERSAL_IDENTIFIERS = [
  ...RECORD_LIST_OBJECT_DEFINITIONS.flatMap((objectDefinition) =>
    Object.values(objectDefinition.fields).map(
      (fieldDefinition) => fieldDefinition.universalIdentifier,
    ),
  ),
  STANDARD_OBJECTS.company.fields.recordListMemberships.universalIdentifier,
  STANDARD_OBJECTS.person.fields.recordListMemberships.universalIdentifier,
  STANDARD_OBJECTS.opportunity.fields.recordListMemberships
    .universalIdentifier,
];

const RECORD_LIST_INDEX_UNIVERSAL_IDENTIFIERS =
  RECORD_LIST_OBJECT_DEFINITIONS.flatMap((objectDefinition) =>
    Object.values(objectDefinition.indexes).map(
      (indexDefinition) => indexDefinition.universalIdentifier,
    ),
  );

const RECORD_LIST_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIERS = [
  STANDARD_NAVIGATION_MENU_ITEMS.lists.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000005000)
@Command({
  name: 'upgrade:2-15:add-record-lists',
  description: 'Install the standard static record list objects and relations',
})
export class AddRecordListsCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly featureFlagService: FeatureFlagService,
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
    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps,
      flatNavigationMenuItemMaps,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'flatIndexMaps',
      'flatNavigationMenuItemMaps',
    ]);
    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const allFlatEntityOperationByMetadataName = {
      objectMetadata: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatObjectMetadata>({
            standardFlatEntityMaps:
              standardAllFlatEntityMaps.flatObjectMetadataMaps,
            existingFlatEntityMaps: flatObjectMetadataMaps,
            universalIdentifiers:
              RECORD_LIST_OBJECT_UNIVERSAL_IDENTIFIERS,
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
              RECORD_LIST_FIELD_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
      index: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatIndexMetadata>({
            standardFlatEntityMaps: standardAllFlatEntityMaps.flatIndexMaps,
            existingFlatEntityMaps: flatIndexMaps,
            universalIdentifiers:
              RECORD_LIST_INDEX_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
      navigationMenuItem: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatNavigationMenuItem>({
            standardFlatEntityMaps:
              standardAllFlatEntityMaps.flatNavigationMenuItemMaps,
            existingFlatEntityMaps: flatNavigationMenuItemMaps,
            universalIdentifiers:
              RECORD_LIST_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
    };
    const operationCount = Object.values(
      allFlatEntityOperationByMetadataName,
    ).reduce(
      (count, operations) => count + operations.flatEntityToCreate.length,
      0,
    );

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would create ${operationCount} record list metadata entities and enable Lists for workspace ${workspaceId}`,
      );

      return;
    }

    if (operationCount > 0) {
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
          `Failed to create record list metadata for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
        );
      }
    }

    await this.featureFlagService.enableFeatureFlags(
      [FeatureFlagKey.IS_RECORD_LISTS_ENABLED],
      workspaceId,
    );
    this.logger.log(
      `Created ${operationCount} record list metadata entities and enabled Lists for workspace ${workspaceId}`,
    );
  }
}
