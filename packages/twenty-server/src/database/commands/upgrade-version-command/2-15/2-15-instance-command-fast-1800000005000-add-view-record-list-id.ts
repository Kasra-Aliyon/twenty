import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.15.0', 1800000005000)
export class AddViewRecordListIdFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."view" ADD COLUMN IF NOT EXISTS "recordListId" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_VIEW_WORKSPACE_ID_RECORD_LIST_ID_UNIQUE" ON "core"."view" ("workspaceId", "recordListId") WHERE "recordListId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VIEW_WORKSPACE_ID_RECORD_LIST_ID_UNIQUE"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."view" DROP COLUMN IF EXISTS "recordListId"`,
    );
  }
}
