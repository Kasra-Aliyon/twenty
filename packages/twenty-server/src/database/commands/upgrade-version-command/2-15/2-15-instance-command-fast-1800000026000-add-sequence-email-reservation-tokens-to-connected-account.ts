import { QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.15.0', 1800000026000)
export class AddSequenceEmailReservationTokensToConnectedAccountFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."connectedAccount"
       ADD COLUMN IF NOT EXISTS "sequenceDailyEmailReservationTokens" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."connectedAccount"
       DROP COLUMN IF EXISTS "sequenceDailyEmailReservationTokens"`,
    );
  }
}
