import { QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.15.0', 1800000020500)
export class AddSequenceEmailLimitsToConnectedAccountFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."connectedAccount"
       ADD COLUMN IF NOT EXISTS "sequenceDailyEmailLimitEnabled" boolean NOT NULL DEFAULT false,
       ADD COLUMN IF NOT EXISTS "sequenceDailyEmailLimit" integer NOT NULL DEFAULT 30,
       ADD COLUMN IF NOT EXISTS "sequenceDailyEmailUsageDate" date,
       ADD COLUMN IF NOT EXISTS "sequenceDailyEmailUsageCount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `DO $command$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'CHK_connectedAccount_sequenceDailyEmailLimit_range'
             AND conrelid = '"core"."connectedAccount"'::regclass
         ) THEN
           ALTER TABLE "core"."connectedAccount"
           ADD CONSTRAINT "CHK_connectedAccount_sequenceDailyEmailLimit_range"
           CHECK ("sequenceDailyEmailLimit" BETWEEN 1 AND 200);
         END IF;

         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative'
             AND conrelid = '"core"."connectedAccount"'::regclass
         ) THEN
           ALTER TABLE "core"."connectedAccount"
           ADD CONSTRAINT "CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative"
           CHECK ("sequenceDailyEmailUsageCount" >= 0);
         END IF;
       END;
       $command$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."connectedAccount" DROP CONSTRAINT IF EXISTS "CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."connectedAccount" DROP CONSTRAINT IF EXISTS "CHK_connectedAccount_sequenceDailyEmailLimit_range"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."connectedAccount" DROP COLUMN IF EXISTS "sequenceDailyEmailUsageCount"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."connectedAccount" DROP COLUMN IF EXISTS "sequenceDailyEmailUsageDate"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."connectedAccount" DROP COLUMN IF EXISTS "sequenceDailyEmailLimit"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."connectedAccount" DROP COLUMN IF EXISTS "sequenceDailyEmailLimitEnabled"',
    );
  }
}
