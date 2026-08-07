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

const PERSON_ADDRESS_FIELD_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.person.fields.address.universalIdentifier;

const PERSON_ADDRESS_VIEW_FIELD_UNIVERSAL_IDENTIFIERS = [
  STANDARD_OBJECTS.person.views.allPeople.viewFields.addressCountry
    .universalIdentifier,
  STANDARD_OBJECTS.person.views.personRecordPageFields.viewFields.address
    .universalIdentifier,
];

const COMPANY_ADDRESS_VIEW_FIELD_UNIVERSAL_IDENTIFIER =
  STANDARD_OBJECTS.company.views.allCompanies.viewFields.address
    .universalIdentifier;

@RegisteredWorkspaceCommand('2.15.0', 1800000018000)
@Command({
  name: 'upgrade:2-15:add-person-and-company-country-columns',
  description:
    'Add the Person address field and expose country-only columns for People and Companies',
})
export class AddPersonAndCompanyCountryColumnsCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
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
    const fieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatFieldMetadata>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatFieldMetadataMaps,
        existingFlatEntityMaps: flatFieldMetadataMaps,
        universalIdentifiers: [PERSON_ADDRESS_FIELD_UNIVERSAL_IDENTIFIER],
      });
    const viewFieldsToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatViewField>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatViewFieldMaps,
        existingFlatEntityMaps: flatViewFieldMaps,
        universalIdentifiers: PERSON_ADDRESS_VIEW_FIELD_UNIVERSAL_IDENTIFIERS,
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
      fieldsToCreate.length === 0 &&
      viewFieldsToCreate.length === 0 &&
      viewFieldsToUpdate.length === 0
    ) {
      this.logger.log(
        `People and Companies country columns already exist for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Creating ${fieldsToCreate.length} Person address field(s), creating ${viewFieldsToCreate.length} Person view field(s), and updating ${viewFieldsToUpdate.length} Company view field(s) for workspace ${workspaceId}`,
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
              flatEntityToUpdate: viewFieldsToUpdate,
            },
          },
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to add People and Companies country columns for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
      );
    }

    this.logger.log(
      `Added People and Companies country columns for workspace ${workspaceId}`,
    );
  }
}
