import { type QueryRunner } from 'typeorm';

import { AddSequenceEmailReservationTokensToConnectedAccountFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-instance-command-fast-1800000026000-add-sequence-email-reservation-tokens-to-connected-account';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('2.15 sequence email reservation-token schema command', () => {
  it('idempotently adds the durable connected-account token ledger', async () => {
    const query = jest.fn();
    const command =
      new AddSequenceEmailReservationTokensToConnectedAccountFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ADD COLUMN IF NOT EXISTS "sequenceDailyEmailReservationTokens" jsonb',
      ),
    );
  });

  it('safely removes the token ledger during a down migration', async () => {
    const query = jest.fn();
    const command =
      new AddSequenceEmailReservationTokensToConnectedAccountFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'DROP COLUMN IF EXISTS "sequenceDailyEmailReservationTokens"',
      ),
    );
  });

  it('registers the fast command for instance upgrades', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddSequenceEmailReservationTokensToConnectedAccountFastInstanceCommand,
    );
  });
});
