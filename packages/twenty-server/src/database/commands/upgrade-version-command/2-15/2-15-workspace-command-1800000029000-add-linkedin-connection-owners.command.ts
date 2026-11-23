import { Command } from 'nest-commander';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { ViewType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { ViewFieldService } from 'src/engine/metadata-modules/view-field/services/view-field.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { LinkedinConnectionOwnersService } from 'src/modules/linkedin/services/linkedin-connection-owners.service';

const { fields, views } = STANDARD_OBJECTS.person;
const OWNER_FIELD_IDENTIFIER = fields.linkedinConnectedTo.universalIdentifier;
const TEAM_FIELD_IDENTIFIERS = [
  fields.linkedinConnectionState.universalIdentifier,
  fields.linkedinConnectedAt.universalIdentifier,
] as const;

@RegisteredWorkspaceCommand('2.15.0', 1800000029000)
@Command({
  name: 'upgrade:2-15:add-linkedin-connection-owners',
  description: 'Show the members connected to each person on LinkedIn',
})
export class AddLinkedinConnectionOwnersCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly viewFieldService: ViewFieldService,
    private readonly linkedinConnectionOwnersService: LinkedinConnectionOwnersService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({ workspaceId, options }: RunOnWorkspaceArgs) {
    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { flatFieldMetadataMaps, flatViewFieldMaps, flatObjectMetadataMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatFieldMetadataMaps',
        'flatViewFieldMaps',
        'flatObjectMetadataMaps',
      ]);
    if (
      !isDefined(
        flatObjectMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.person.universalIdentifier
        ],
      )
    ) {
      return;
    }
    const { allFlatEntityMaps: standard } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const fieldsToCreate = getStandardFlatEntitiesToCreateOrThrow({
      standardFlatEntityMaps: standard.flatFieldMetadataMaps,
      existingFlatEntityMaps: flatFieldMetadataMaps,
      universalIdentifiers: [OWNER_FIELD_IDENTIFIER],
    });
    const viewFieldsToCreate = getStandardFlatEntitiesToCreateOrThrow({
      standardFlatEntityMaps: standard.flatViewFieldMaps,
      existingFlatEntityMaps: flatViewFieldMaps,
      universalIdentifiers: [
        views.allPeople.viewFields.linkedinConnectedTo.universalIdentifier,
        views.personRecordPageFields.viewFields.linkedinConnectedTo
          .universalIdentifier,
      ],
    });
    const fieldsToUpdate = TEAM_FIELD_IDENTIFIERS.flatMap((identifier) => {
      const existing = flatFieldMetadataMaps.byUniversalIdentifier[identifier];
      const desired =
        standard.flatFieldMetadataMaps.byUniversalIdentifier[identifier];
      if (
        !isDefined(existing) ||
        !isDefined(desired) ||
        (existing.label === desired.label &&
          existing.description === desired.description)
      ) {
        return [];
      }
      return [
        { ...existing, label: desired.label, description: desired.description },
      ];
    });

    if (options.dryRun) {
      this.logger.log(
        `Would add the LinkedIn member column and backfill workspace ${workspaceId}`,
      );
      return;
    }
    if (
      fieldsToCreate.length > 0 ||
      viewFieldsToCreate.length > 0 ||
      fieldsToUpdate.length > 0
    ) {
      const result =
        await this.workspaceMigrationService.validateBuildAndRunWorkspaceMigration(
          {
            workspaceId,
            isSystemBuild: true,
            applicationUniversalIdentifier:
              twentyStandardFlatApplication.universalIdentifier,
            allFlatEntityOperationByMetadataName: {
              fieldMetadata: {
                flatEntityToCreate: fieldsToCreate,
                flatEntityToUpdate: fieldsToUpdate,
                flatEntityToDelete: [],
              },
              viewField: {
                flatEntityToCreate: viewFieldsToCreate,
                flatEntityToUpdate: [],
                flatEntityToDelete: [],
              },
            },
          },
        );
      if (result.status === 'fail') {
        throw new Error(
          `Failed to add LinkedIn connection owners: ${JSON.stringify(result)}`,
        );
      }
    }
    await this.addToExistingPeopleTables(workspaceId);
    await this.linkedinConnectionOwnersService.refresh(workspaceId);
  }

  private async addToExistingPeopleTables(workspaceId: string) {
    const { flatViewFieldMaps, flatFieldMetadataMaps, flatViewMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatViewFieldMaps',
        'flatFieldMetadataMaps',
        'flatViewMaps',
      ]);
    const field =
      flatFieldMetadataMaps.byUniversalIdentifier[OWNER_FIELD_IDENTIFIER];
    if (!isDefined(field)) {
      throw new Error(
        'LinkedIn connected to is missing after the workspace migration',
      );
    }
    const viewFields = Object.values(
      flatViewFieldMaps.byUniversalIdentifier,
    ).filter(isDefined);
    const createViewFieldInputs = Object.values(
      flatViewMaps.byUniversalIdentifier,
    )
      .filter(isDefined)
      .filter(
        (view) =>
          !view.deletedAt &&
          view.type === ViewType.TABLE &&
          view.objectMetadataId === field.objectMetadataId,
      )
      .flatMap((view) => {
        const columns = viewFields.filter(
          (column) => column.viewId === view.id && !column.deletedAt,
        );
        if (columns.some((column) => column.fieldMetadataId === field.id)) {
          return [];
        }
        const visibleColumns = columns
          .filter((column) => column.isVisible)
          .sort((left, right) => left.position - right.position);
        const index = visibleColumns.findIndex((column) =>
          TEAM_FIELD_IDENTIFIERS.some(
            (identifier) =>
              identifier === column.fieldMetadataUniversalIdentifier,
          ),
        );
        if (index === -1) {
          return [];
        }
        const anchor = visibleColumns[index].position;
        const previous = visibleColumns[index - 1]?.position ?? anchor - 1;
        return [
          {
            fieldMetadataId: field.id,
            viewId: view.id,
            position: (previous + anchor) / 2,
            size: 240,
            isVisible: true,
          },
        ];
      });
    await this.viewFieldService.createMany({
      workspaceId,
      createViewFieldInputs,
    });
  }
}
