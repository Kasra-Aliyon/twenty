import { ConfigSource } from 'src/engine/core-modules/twenty-config/enums/config-source.enum';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

import { MigrateLocalDevelopmentPortsCommand } from '../migrate-local-development-ports.command';

describe('MigrateLocalDevelopmentPortsCommand', () => {
  const createTwentyConfigService = (
    values: Partial<Record<string, { source: ConfigSource; value: string }>>,
  ) =>
    ({
      getVariableWithMetadata: jest.fn((key: string) => {
        const configVariable = values[key];

        return configVariable === undefined
          ? null
          : {
              ...configVariable,
              metadata: {},
            };
      }),
      update: jest.fn(),
    }) as unknown as jest.Mocked<TwentyConfigService>;

  it('should not persist matching database values during a dry-run', async () => {
    const twentyConfigService = createTwentyConfigService({
      AUTH_GOOGLE_CALLBACK_URL: {
        source: ConfigSource.DATABASE,
        value: 'http://localhost:3000/auth/google/redirect',
      },
    });
    const command = new MigrateLocalDevelopmentPortsCommand(
      twentyConfigService,
    );

    await command.run([], {});

    expect(twentyConfigService.update).not.toHaveBeenCalled();
  });

  it('should migrate only exact matching database values when apply is enabled', async () => {
    const twentyConfigService = createTwentyConfigService({
      AUTH_GOOGLE_APIS_CALLBACK_URL: {
        source: ConfigSource.DATABASE,
        value: 'http://localhost:3000/auth/google-apis/get-access-token',
      },
      AUTH_GOOGLE_CALLBACK_URL: {
        source: ConfigSource.DATABASE,
        value: 'http://localhost:3000/auth/google/redirect',
      },
      AUTH_MICROSOFT_CALLBACK_URL: {
        source: ConfigSource.ENVIRONMENT,
        value: 'http://localhost:3000/auth/microsoft/redirect',
      },
      FRONTEND_URL: {
        source: ConfigSource.DATABASE,
        value: 'https://custom.example.com',
      },
    });
    const command = new MigrateLocalDevelopmentPortsCommand(
      twentyConfigService,
    );

    await command.run([], { apply: true });

    expect(twentyConfigService.update).toHaveBeenCalledTimes(2);
    expect(twentyConfigService.update).toHaveBeenNthCalledWith(
      1,
      'AUTH_GOOGLE_APIS_CALLBACK_URL',
      'http://localhost:2000/auth/google-apis/get-access-token',
    );
    expect(twentyConfigService.update).toHaveBeenNthCalledWith(
      2,
      'AUTH_GOOGLE_CALLBACK_URL',
      'http://localhost:2000/auth/google/redirect',
    );
  });

  it('should be idempotent once database values use the migrated ports', async () => {
    const twentyConfigService = createTwentyConfigService({
      AUTH_GOOGLE_CALLBACK_URL: {
        source: ConfigSource.DATABASE,
        value: 'http://localhost:2000/auth/google/redirect',
      },
      FRONTEND_URL: {
        source: ConfigSource.DATABASE,
        value: 'http://localhost:2001',
      },
    });
    const command = new MigrateLocalDevelopmentPortsCommand(
      twentyConfigService,
    );

    await command.run([], { apply: true });

    expect(twentyConfigService.update).not.toHaveBeenCalled();
  });
});
