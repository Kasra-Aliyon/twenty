import { validate } from 'class-validator';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ConnectedAccountMetadataService } from 'src/engine/metadata-modules/connected-account/connected-account-metadata.service';
import { ConnectedAccountSequenceEmailSettingsInput } from 'src/engine/metadata-modules/connected-account/dtos/connected-account-sequence-email-settings.input';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { ConnectedAccountResolver } from 'src/engine/metadata-modules/connected-account/resolvers/connected-account.resolver';

const CONNECTED_ACCOUNT_ID = '20202020-1111-4111-8111-111111111111';
const USER_WORKSPACE_ID = '20202020-2222-4222-8222-222222222222';
const WORKSPACE_ID = '20202020-3333-4333-8333-333333333333';

describe('ConnectedAccountResolver', () => {
  const connectedAccountMetadataService = {
    update: jest.fn(),
    verifyOwnership: jest.fn(),
  } as unknown as jest.Mocked<ConnectedAccountMetadataService>;
  const resolver = new ConnectedAccountResolver(
    connectedAccountMetadataService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates sequence email limits only after verifying account ownership', async () => {
    const input: ConnectedAccountSequenceEmailSettingsInput = {
      sequenceDailyEmailLimitEnabled: true,
      sequenceDailyEmailLimit: 45,
    };
    const updatedAccount = {
      id: CONNECTED_ACCOUNT_ID,
      connectionParameters: null,
      sequenceDailyEmailLimitEnabled: true,
      sequenceDailyEmailLimit: 45,
    } as ConnectedAccountEntity;

    connectedAccountMetadataService.verifyOwnership.mockResolvedValue(
      updatedAccount,
    );
    connectedAccountMetadataService.update.mockResolvedValue(updatedAccount);

    const result = await resolver.updateConnectedAccountSequenceEmailSettings(
      CONNECTED_ACCOUNT_ID,
      input,
      { id: WORKSPACE_ID } as WorkspaceEntity,
      USER_WORKSPACE_ID,
    );

    expect(
      connectedAccountMetadataService.verifyOwnership,
    ).toHaveBeenCalledWith({
      id: CONNECTED_ACCOUNT_ID,
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(connectedAccountMetadataService.update).toHaveBeenCalledWith({
      id: CONNECTED_ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      data: input,
    });
    expect(result).toMatchObject(input);
    expect(
      connectedAccountMetadataService.verifyOwnership.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      connectedAccountMetadataService.update.mock.invocationCallOrder[0],
    );
  });

  it('does not update sequence email limits when ownership verification fails', async () => {
    connectedAccountMetadataService.verifyOwnership.mockRejectedValue(
      new Error('Account ownership violation'),
    );

    await expect(
      resolver.updateConnectedAccountSequenceEmailSettings(
        CONNECTED_ACCOUNT_ID,
        {
          sequenceDailyEmailLimitEnabled: true,
          sequenceDailyEmailLimit: 45,
        },
        { id: WORKSPACE_ID } as WorkspaceEntity,
        USER_WORKSPACE_ID,
      ),
    ).rejects.toThrow('Account ownership violation');
    expect(connectedAccountMetadataService.update).not.toHaveBeenCalled();
  });

  it('validates the sequence email limit input', async () => {
    const input = Object.assign(
      new ConnectedAccountSequenceEmailSettingsInput(),
      {
        sequenceDailyEmailLimitEnabled: 'yes',
        sequenceDailyEmailLimit: 0,
      },
    );

    const errors = await validate(input);

    expect(errors.map(({ property }) => property).sort()).toEqual([
      'sequenceDailyEmailLimit',
      'sequenceDailyEmailLimitEnabled',
    ]);

    const overLimitInput = Object.assign(
      new ConnectedAccountSequenceEmailSettingsInput(),
      {
        sequenceDailyEmailLimitEnabled: true,
        sequenceDailyEmailLimit: 201,
      },
    );
    const overLimitErrors = await validate(overLimitInput);

    expect(overLimitErrors).toEqual([
      expect.objectContaining({ property: 'sequenceDailyEmailLimit' }),
    ]);
  });
});
