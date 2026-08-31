import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { type FlatViewField } from 'src/engine/metadata-modules/flat-view-field/types/flat-view-field.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const LOCATION_VIEW_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.person.views.allPeople.viewFields.addressCountry
    .universalIdentifier,
  STANDARD_OBJECTS.person.views.allPeople.viewFields.timeZone
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.allCompanies.viewFields.addressCountry
    .universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000028000)
@Command({
  name: 'upgrade:2-15:show-apollo-location-columns',
  description:
    'Show Country and Time zone on People lists and Country on Company lists',
})
export class ShowApolloLocationColumnsCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
    const { flatObjectMetadataMaps, flatViewFieldMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatViewFieldMaps',
      ]);

    if (
      !isDefined(
        flatObjectMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.person.universalIdentifier
        ],
      ) ||
      !isDefined(
        flatObjectMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.company.universalIdentifier
        ],
      )
    ) {
      this.logger.log(
        `Person or Company object metadata does not exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const viewFieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatViewField>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatViewFieldMaps,
        existingFlatEntityMaps: flatViewFieldMaps,
        universalIdentifiers: LOCATION_VIEW_FIELD_UNIVERSAL_IDENTIFIERS,
      });
    const viewFieldsToUpdate = LOCATION_VIEW_FIELD_UNIVERSAL_IDENTIFIERS.flatMap(
      (universalIdentifier) => {
        const existingViewField =
          flatViewFieldMaps.byUniversalIdentifier[universalIdentifier];

        return isDefined(existingViewField) && !existingViewField.isVisible
          ? [{ ...existingViewField, isVisible: true }]
          : [];
      },
    );

    if (viewFieldsToCreate.length === 0 && viewFieldsToUpdate.length === 0) {
      this.logger.log(
        `Apollo location columns are already visible for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Creating ${viewFieldsToCreate.length} and showing ${viewFieldsToUpdate.length} Apollo location view field(s) for workspace ${workspaceId}`,
    );

    if (isDryRun) {
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
            viewField: {
              flatEntityToCreate: viewFieldsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: viewFieldsToUpdate,
            },
          },
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to show Apollo location columns for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Apollo location columns are visible for workspace ${workspaceId}`,
    );
  }
}
