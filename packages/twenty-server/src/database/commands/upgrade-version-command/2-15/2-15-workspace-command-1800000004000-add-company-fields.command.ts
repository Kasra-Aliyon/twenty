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
import { type FlatViewField } from 'src/engine/metadata-modules/flat-view-field/types/flat-view-field.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const COMPANY_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.company.fields.employees.universalIdentifier,
  STANDARD_OBJECTS.company.fields.industry.universalIdentifier,
  STANDARD_OBJECTS.company.fields.keywords.universalIdentifier,
  STANDARD_OBJECTS.company.fields.companyPhone.universalIdentifier,
  STANDARD_OBJECTS.company.fields.technologies.universalIdentifier,
  STANDARD_OBJECTS.company.fields.segments.universalIdentifier,
  STANDARD_OBJECTS.company.fields.accountStatus.universalIdentifier,
  STANDARD_OBJECTS.company.fields.companyType.universalIdentifier,
];

const COMPANY_VIEW_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.employees
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.industry
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.keywords
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.companyPhone
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.technologies
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.segments
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.accountStatus
    .universalIdentifier,
  STANDARD_OBJECTS.company.views.companyRecordPageFields.viewFields.companyType
    .universalIdentifier,
];

@RegisteredWorkspaceCommand('2.15.0', 1800000004000)
@Command({
  name: 'upgrade:2-15:add-company-fields',
  description:
    'Create the new standard Company fields and add them to the Company record page',
})
export class AddCompanyFieldsCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatViewFieldMaps,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
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
    const fieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatFieldMetadata>({
        standardFlatEntityMaps:
          standardAllFlatEntityMaps.flatFieldMetadataMaps,
        existingFlatEntityMaps: flatFieldMetadataMaps,
        universalIdentifiers: COMPANY_FIELD_UNIVERSAL_IDENTIFIERS,
      });
    const viewFieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatViewField>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatViewFieldMaps,
        existingFlatEntityMaps: flatViewFieldMaps,
        universalIdentifiers: COMPANY_VIEW_FIELD_UNIVERSAL_IDENTIFIERS,
      });

    if (fieldsToCreate.length === 0 && viewFieldsToCreate.length === 0) {
      this.logger.log(
        `All new Company fields already exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Creating ${fieldsToCreate.length} Company field(s) and ${viewFieldsToCreate.length} Company record-page field(s) for workspace ${workspaceId}`,
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
            fieldMetadata: {
              flatEntityToCreate: fieldsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
            viewField: {
              flatEntityToCreate: viewFieldsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to create Company fields for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Created ${fieldsToCreate.length} Company field(s) and ${viewFieldsToCreate.length} Company record-page field(s) for workspace ${workspaceId}`,
    );
  }
}
