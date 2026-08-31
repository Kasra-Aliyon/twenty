import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { ShowApolloLocationColumnsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000028000-show-apollo-location-columns.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

describe('ShowApolloLocationColumnsCommand', () => {
  it('makes existing People location and Company country columns visible', async () => {
    const validateBuildAndRunWorkspaceMigration = jest
      .fn()
      .mockResolvedValue({ status: 'success' });
    const viewFields = [
      STANDARD_OBJECTS.person.views.allPeople.viewFields.addressCountry,
      STANDARD_OBJECTS.person.views.allPeople.viewFields.timeZone,
      STANDARD_OBJECTS.company.views.allCompanies.viewFields.addressCountry,
    ].map(({ universalIdentifier }, index) => ({
      id: `view-field-${index}`,
      universalIdentifier,
      isVisible: false,
    }));
    const command = new ShowApolloLocationColumnsCommand(
      {} as WorkspaceIteratorService,
      {
        findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
          .fn()
          .mockResolvedValue({
            twentyStandardFlatApplication: {
              id: '20202020-2222-4222-8222-222222222222',
              universalIdentifier: '20202020-2222-4222-8222-222222222223',
            },
          }),
      } as unknown as ApplicationService,
      {
        getOrRecompute: jest.fn().mockResolvedValue({
          flatObjectMetadataMaps: {
            byId: {},
            byUniversalIdentifier: {
              [STANDARD_OBJECTS.person.universalIdentifier]: {
                id: 'person-object-id',
              },
              [STANDARD_OBJECTS.company.universalIdentifier]: {
                id: 'company-object-id',
              },
            },
          },
          flatViewFieldMaps: {
            byId: {},
            byUniversalIdentifier: Object.fromEntries(
              viewFields.map((viewField) => [
                viewField.universalIdentifier,
                viewField,
              ]),
            ),
          },
        }),
      } as unknown as WorkspaceCacheService,
      {
        validateBuildAndRunWorkspaceMigration,
      } as unknown as WorkspaceMigrationValidateBuildAndRunService,
    );

    await command.runOnWorkspace({
      workspaceId: '20202020-1111-4111-8111-111111111111',
      options: {},
      index: 0,
      total: 1,
    });

    const operations =
      validateBuildAndRunWorkspaceMigration.mock.calls[0][0]
        .allFlatEntityOperationByMetadataName;

    expect(operations.viewField.flatEntityToCreate).toEqual([]);
    expect(operations.viewField.flatEntityToUpdate).toHaveLength(3);
    expect(operations.viewField.flatEntityToUpdate).toEqual(
      expect.arrayContaining(
        viewFields.map((viewField) => ({
          ...viewField,
          isVisible: true,
        })),
      ),
    );
  });
});
