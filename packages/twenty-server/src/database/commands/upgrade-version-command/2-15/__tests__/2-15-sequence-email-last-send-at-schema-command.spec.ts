import { type QueryRunner } from 'typeorm';

import { AddSequenceEmailLastSendAtToConnectedAccountFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-instance-command-fast-1800000025000-add-sequence-email-last-send-at-to-connected-account';
import { INSTANCE_COMMANDS } from 'src/database/commands/upgrade-version-command/instance-commands.constant';

describe('2.15 sequence email last-send watermark schema command', () => {
  it('idempotently adds the nullable connected-account watermark', async () => {
    const query = jest.fn();
    const command =
      new AddSequenceEmailLastSendAtToConnectedAccountFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ADD COLUMN IF NOT EXISTS "sequenceEmailLastSendAt" timestamptz',
      ),
    );
  });

  it('safely removes the watermark during a down migration', async () => {
    const query = jest.fn();
    const command =
      new AddSequenceEmailLastSendAtToConnectedAccountFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'DROP COLUMN IF EXISTS "sequenceEmailLastSendAt"',
      ),
    );
  });

  it('registers the fast command for instance upgrades', () => {
    expect(INSTANCE_COMMANDS).toContain(
      AddSequenceEmailLastSendAtToConnectedAccountFastInstanceCommand,
    );
  });
});
