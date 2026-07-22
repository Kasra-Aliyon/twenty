import { Command } from 'nest-commander';
import { InjectDataSource } from '@nestjs/typeorm';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FeatureFlagKey } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { migrateLegacyLinkedinData } from 'src/database/commands/upgrade-version-command/2-15/utils/migrate-legacy-linkedin-data.util';
import {
  buildUniboxLinkedinLegacyObjectRenames,
  findUniboxLinkedinLegacyObjects,
} from 'src/database/commands/upgrade-version-command/2-15/utils/unibox-linkedin-name-collision.util';
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

const UNIBOX_OBJECT_DEFINITIONS = [
  STANDARD_OBJECTS.messageDraft,
  STANDARD_OBJECTS.linkedinMessageThread,
  STANDARD_OBJECTS.linkedinMessage,
  STANDARD_OBJECTS.linkedinThreadParticipant,
  STANDARD_OBJECTS.linkedinConnection,
  STANDARD_OBJECTS.linkedinInvitation,
];

const UNIBOX_OBJECT_UNIVERSAL_IDENTIFIERS = UNIBOX_OBJECT_DEFINITIONS.map(
  (objectDefinition) => objectDefinition.universalIdentifier,
);

const UNIBOX_FIELD_UNIVERSAL_IDENTIFIERS = [
  ...UNIBOX_OBJECT_DEFINITIONS.flatMap((objectDefinition) =>
    Object.values(objectDefinition.fields).map(
      (fieldDefinition) => fieldDefinition.universalIdentifier,
    ),
  ),
  STANDARD_OBJECTS.messageThread.fields.messageDrafts.universalIdentifier,
  STANDARD_OBJECTS.workspaceMember.fields.messageDrafts.universalIdentifier,
  STANDARD_OBJECTS.person.fields.linkedinThreadParticipants.universalIdentifier,
  STANDARD_OBJECTS.person.fields.linkedinConnections.universalIdentifier,
];

const UNIBOX_INDEX_UNIVERSAL_IDENTIFIERS = UNIBOX_OBJECT_DEFINITIONS.flatMap(
  (objectDefinition) =>
    Object.values(objectDefinition.indexes).map(
      (indexDefinition) => indexDefinition.universalIdentifier,
    ),
);

const UNIBOX_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIERS = [
  STANDARD_NAVIGATION_MENU_ITEMS.unibox.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000009000)
@Command({
  name: 'upgrade:2-15:add-unibox',
  description:
    'Install the Unibox email and LinkedIn standard objects and navigation item',
})
export class AddUniboxCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly featureFlagService: FeatureFlagService,
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
    const { twentyStandardFlatApplication, workspaceCustomFlatApplication } =
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

    const now = new Date().toISOString();
    const legacyObjectsBeforeRenames = findUniboxLinkedinLegacyObjects({
      flatObjectMetadataMaps,
      workspaceCustomApplicationId: workspaceCustomFlatApplication.id,
    });
    const legacyObjectRenames = buildUniboxLinkedinLegacyObjectRenames({
      flatObjectMetadataMaps,
      now,
      workspaceCustomApplicationId: workspaceCustomFlatApplication.id,
    });
    const renamedObjectMetadataById = new Map(
      legacyObjectRenames.map(({ renamedObjectMetadata }) => [
        renamedObjectMetadata.id,
        renamedObjectMetadata,
      ]),
    );
    const legacyObjectsAfterRenames = legacyObjectsBeforeRenames.map(
      ({ objectMetadata, objectName }) => ({
        objectName,
        objectMetadata:
          renamedObjectMetadataById.get(objectMetadata.id) ?? objectMetadata,
      }),
    );

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now,
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
            universalIdentifiers: UNIBOX_OBJECT_UNIVERSAL_IDENTIFIERS,
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
            universalIdentifiers: UNIBOX_FIELD_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
      index: {
        flatEntityToCreate:
          getStandardFlatEntitiesToCreateOrThrow<FlatIndexMetadata>({
            standardFlatEntityMaps: standardAllFlatEntityMaps.flatIndexMaps,
            existingFlatEntityMaps: flatIndexMaps,
            universalIdentifiers: UNIBOX_INDEX_UNIVERSAL_IDENTIFIERS,
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
              UNIBOX_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIERS,
          }),
        flatEntityToDelete: [],
        flatEntityToUpdate: [],
      },
    };
    const createOperationCount = Object.values(
      allFlatEntityOperationByMetadataName,
    ).reduce(
      (count, operations) => count + operations.flatEntityToCreate.length,
      0,
    );
    const operationCount = legacyObjectRenames.length + createOperationCount;

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would rename ${legacyObjectRenames.length} legacy LinkedIn object(s), create ${createOperationCount} Unibox metadata entities, migrate ${legacyObjectsAfterRenames.length} legacy LinkedIn dataset(s), and enable Unibox for workspace ${workspaceId}`,
      );

      return;
    }

    // Renames must commit before standard objects are created because the API
    // names and physical table names are unique within a workspace.
    for (const { renamedObjectMetadata } of legacyObjectRenames) {
      const renameResult =
        await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
          {
            workspaceId,
            isSystemBuild: true,
            applicationUniversalIdentifier:
              renamedObjectMetadata.applicationUniversalIdentifier,
            allFlatEntityOperationByMetadataName: {
              objectMetadata: {
                flatEntityToCreate: [],
                flatEntityToDelete: [],
                flatEntityToUpdate: [renamedObjectMetadata],
              },
            },
          },
        );

      if (renameResult.status === 'fail') {
        throw new Error(
          `Failed to preserve a legacy LinkedIn object for workspace ${workspaceId}: ${JSON.stringify(renameResult)}`,
        );
      }
    }

    if (createOperationCount > 0) {
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
          `Failed to create Unibox metadata for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
        );
      }
    }

    await migrateLegacyLinkedinData({
      dataSource: this.coreDataSource,
      legacyObjects: legacyObjectsAfterRenames,
      workspaceId,
    });

    await this.featureFlagService.enableFeatureFlags(
      [FeatureFlagKey.IS_UNIBOX_ENABLED],
      workspaceId,
    );
    this.logger.log(
      `Applied ${operationCount} Unibox metadata operations, migrated ${legacyObjectsAfterRenames.length} legacy LinkedIn dataset(s), and enabled Unibox for workspace ${workspaceId}`,
    );
  }
}
