import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddPersonTimeZoneCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000022000-add-person-time-zone.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

describe('AddPersonTimeZoneCommand', () => {
  it('creates the Person field and both visible view fields for existing workspaces', async () => {
    const validateBuildAndRunWorkspaceMigration = jest
      .fn()
      .mockResolvedValue({ status: 'success' });
    const command = new AddPersonTimeZoneCommand(
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
            },
          },
          flatFieldMetadataMaps: { byId: {}, byUniversalIdentifier: {} },
          flatViewFieldMaps: { byId: {}, byUniversalIdentifier: {} },
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

    const migrationInput =
      validateBuildAndRunWorkspaceMigration.mock.calls[0][0];
    const operations =
      migrationInput.allFlatEntityOperationByMetadataName;

    expect(operations.fieldMetadata.flatEntityToCreate).toHaveLength(1);
    expect(operations.fieldMetadata.flatEntityToCreate[0]).toMatchObject({
      universalIdentifier:
        STANDARD_OBJECTS.person.fields.timeZone.universalIdentifier,
      name: 'timeZone',
    });
    expect(operations.viewField.flatEntityToCreate).toHaveLength(2);
    expect(
      operations.viewField.flatEntityToCreate.map(
        ({ universalIdentifier }: { universalIdentifier: string }) =>
          universalIdentifier,
      ),
    ).toEqual(
      expect.arrayContaining([
        STANDARD_OBJECTS.person.views.allPeople.viewFields.timeZone
          .universalIdentifier,
        STANDARD_OBJECTS.person.views.personRecordPageFields.viewFields.timeZone
          .universalIdentifier,
      ]),
    );
  });
});
