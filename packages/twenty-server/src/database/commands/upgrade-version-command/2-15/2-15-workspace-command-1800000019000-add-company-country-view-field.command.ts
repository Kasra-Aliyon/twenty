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

const COMPANY_ADDRESS_VIEW_FIELD_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.company.views.allCompanies.viewFields.address
    .universalIdentifier;
const COMPANY_COUNTRY_VIEW_FIELD_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.company.views.allCompanies.viewFields.addressCountry
    .universalIdentifier;

@RegisteredWorkspaceCommand('2.15.0', 1800000019000)
@Command({
  name: 'upgrade:2-15:add-company-country-view-field',
  description:
    'Keep the Company address column and add country as a separate view field',
})
export class AddCompanyCountryViewFieldCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
          STANDARD_OBJECTS.company.universalIdentifier
        ],
      )
    ) {
      this.logger.log(
        `Company object metadata does not exist for workspace ${workspaceId}, skipping`,
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
        universalIdentifiers: [
          COMPANY_COUNTRY_VIEW_FIELD_UNIVERSAL_IDENTIFIER,
        ],
      });
    const existingCompanyAddressViewField =
      flatViewFieldMaps.byUniversalIdentifier[
        COMPANY_ADDRESS_VIEW_FIELD_UNIVERSAL_IDENTIFIER
      ];
    const standardCompanyAddressViewField =
      standardAllFlatEntityMaps.flatViewFieldMaps.byUniversalIdentifier[
        COMPANY_ADDRESS_VIEW_FIELD_UNIVERSAL_IDENTIFIER
      ];
    const viewFieldsToUpdate =
      isDefined(existingCompanyAddressViewField) &&
      isDefined(standardCompanyAddressViewField) &&
      existingCompanyAddressViewField.subFieldName !==
        standardCompanyAddressViewField.subFieldName
        ? [
            {
              ...existingCompanyAddressViewField,
              subFieldName: standardCompanyAddressViewField.subFieldName,
            },
          ]
        : [];

    if (
      viewFieldsToCreate.length === 0 &&
      viewFieldsToUpdate.length === 0
    ) {
      this.logger.log(
        `Company address and country columns already exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Creating ${viewFieldsToCreate.length} Company country view field(s) and updating ${viewFieldsToUpdate.length} Company address view field(s) for workspace ${workspaceId}`,
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
        `Failed to add the Company country view field for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Added the Company country view field for workspace ${workspaceId}`,
    );
  }
}
