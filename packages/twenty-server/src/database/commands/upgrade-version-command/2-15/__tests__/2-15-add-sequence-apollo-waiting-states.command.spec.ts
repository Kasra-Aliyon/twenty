import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { SEQUENCE_WAITING_ON } from 'twenty-shared/types';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddSequenceApolloWaitingStatesCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000027000-add-sequence-apollo-waiting-states.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

describe('AddSequenceApolloWaitingStatesCommand', () => {
  const setup = ({ dryRun = false }: { dryRun?: boolean } = {}) => {
    const validateBuildAndRunWorkspaceMigration = jest
      .fn()
      .mockResolvedValue({ status: 'success' });
    const waitingOnUniversalIdentifier =
      STANDARD_OBJECTS.sequenceEnrollment.fields.waitingOn.universalIdentifier;
    const command = new AddSequenceApolloWaitingStatesCommand(
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
          flatFieldMetadataMaps: {
            byId: {},
            byUniversalIdentifier: {
              [waitingOnUniversalIdentifier]: {
                id: 'sequence-waiting-on-field-id',
                universalIdentifier: waitingOnUniversalIdentifier,
                options: [
                  {
                    id: '28665cc6-52bd-44d0-8604-32a87de77047',
                    value: SEQUENCE_WAITING_ON.DELAY,
                    label: 'Delay',
                    position: 0,
                    color: 'orange',
                  },
                ],
              },
            },
          },
        }),
      } as unknown as WorkspaceCacheService,
      {
        validateBuildAndRunWorkspaceMigration,
      } as unknown as WorkspaceMigrationValidateBuildAndRunService,
    );

    return {
      command,
      dryRun,
      validateBuildAndRunWorkspaceMigration,
      waitingOnUniversalIdentifier,
    };
  };

  it('updates existing workspace metadata with every Apollo recovery state', async () => {
    const { command, validateBuildAndRunWorkspaceMigration } = setup();

    await command.runOnWorkspace({
      workspaceId: '20202020-1111-4111-8111-111111111111',
      options: {},
      index: 0,
      total: 1,
    });

    const migrationInput =
      validateBuildAndRunWorkspaceMigration.mock.calls[0][0];
    const [updatedField] =
      migrationInput.allFlatEntityOperationByMetadataName.fieldMetadata
        .flatEntityToUpdate;
    const optionValues = updatedField.options.map(
      ({ value }: { value: string }) => value,
    );

    expect(optionValues).toEqual(
      expect.arrayContaining([
        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
        SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      ]),
    );
  });

  it('reports the schema repair without applying it during a dry run', async () => {
    const { command, validateBuildAndRunWorkspaceMigration } = setup();

    await command.runOnWorkspace({
      workspaceId: '20202020-1111-4111-8111-111111111111',
      options: { dryRun: true },
      index: 0,
      total: 1,
    });

    expect(validateBuildAndRunWorkspaceMigration).not.toHaveBeenCalled();
  });
});
