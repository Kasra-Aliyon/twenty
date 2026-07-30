import { Command, CommandRunner, Option } from 'nest-commander';

import { CommandLogger } from 'src/database/commands/logger';
import { type ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';
import { ConfigSource } from 'src/engine/core-modules/twenty-config/enums/config-source.enum';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

type LocalDevelopmentUrlConfigKey =
  | 'AUTH_GOOGLE_APIS_CALLBACK_URL'
  | 'AUTH_GOOGLE_CALLBACK_URL'
  | 'AUTH_MICROSOFT_APIS_CALLBACK_URL'
  | 'AUTH_MICROSOFT_CALLBACK_URL'
  | 'FRONTEND_URL';

type LocalDevelopmentUrlMigration = {
  key: LocalDevelopmentUrlConfigKey;
  previousValue: string;
  nextValue: string;
};

type MigrateLocalDevelopmentPortsCommandOptions = {
  apply?: boolean;
};

const LOCAL_DEVELOPMENT_URL_MIGRATIONS: LocalDevelopmentUrlMigration[] = [
  {
    key: 'AUTH_GOOGLE_APIS_CALLBACK_URL',
    previousValue: 'http://localhost:3000/auth/google-apis/get-access-token',
    nextValue: 'http://localhost:2000/auth/google-apis/get-access-token',
  },
  {
    key: 'AUTH_GOOGLE_CALLBACK_URL',
    previousValue: 'http://localhost:3000/auth/google/redirect',
    nextValue: 'http://localhost:2000/auth/google/redirect',
  },
  {
    key: 'AUTH_MICROSOFT_APIS_CALLBACK_URL',
    previousValue: 'http://localhost:3000/auth/microsoft-apis/get-access-token',
    nextValue: 'http://localhost:2000/auth/microsoft-apis/get-access-token',
  },
  {
    key: 'AUTH_MICROSOFT_CALLBACK_URL',
    previousValue: 'http://localhost:3000/auth/microsoft/redirect',
    nextValue: 'http://localhost:2000/auth/microsoft/redirect',
  },
  {
    key: 'FRONTEND_URL',
    previousValue: 'http://localhost:3001',
    nextValue: 'http://localhost:2001',
  },
];

@Command({
  name: 'config:migrate-local-development-ports',
  description:
    'Migrates exact database-backed localhost URLs from server/frontend ports 3000/3001 to 2000/2001. Runs as a dry-run unless --apply is provided.',
})
export class MigrateLocalDevelopmentPortsCommand extends CommandRunner {
  protected logger: CommandLogger;

  constructor(private readonly twentyConfigService: TwentyConfigService) {
    super();
    this.logger = new CommandLogger({
      verbose: false,
      constructorName: this.constructor.name,
    });
  }

  @Option({
    flags: '--apply',
    description:
      'Persist eligible database-backed URL changes. Without this flag, only the planned changes are reported.',
    required: false,
  })
  parseApply(): boolean {
    return true;
  }

  override async run(
    _passedParams: string[],
    options: MigrateLocalDevelopmentPortsCommandOptions,
  ): Promise<void> {
    const eligibleMigrations = LOCAL_DEVELOPMENT_URL_MIGRATIONS.filter(
      (migration) => {
        const configVariable = this.twentyConfigService.getVariableWithMetadata(
          migration.key,
        );

        return (
          configVariable?.source === ConfigSource.DATABASE &&
          configVariable.value === migration.previousValue
        );
      },
    );

    if (eligibleMigrations.length === 0) {
      this.logger.log(
        'No database-backed localhost URLs require port migration.',
      );

      return;
    }

    for (const migration of eligibleMigrations) {
      this.logger.log(
        `${options.apply === true ? 'Migrating' : 'Would migrate'} ${migration.key}: ${migration.previousValue} -> ${migration.nextValue}`,
      );

      if (options.apply === true) {
        await this.twentyConfigService.update<
          LocalDevelopmentUrlConfigKey & keyof ConfigVariables
        >(migration.key, migration.nextValue);
      }
    }

    if (options.apply !== true) {
      this.logger.warn(
        `Dry-run complete. Re-run with --apply to persist ${eligibleMigrations.length} change(s).`,
      );

      return;
    }

    this.logger.log(
      `Migrated ${eligibleMigrations.length} database-backed localhost URL(s).`,
    );
  }
}
