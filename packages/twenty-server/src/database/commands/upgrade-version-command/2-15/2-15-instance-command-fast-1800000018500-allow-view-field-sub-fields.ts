import { type QueryRunner } from 'typeorm';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.15.0', 1800000018500)
export class AllowViewFieldSubFieldsFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VIEW_FIELD_FIELD_METADATA_ID_VIEW_ID_UNIQUE"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_VIEW_FIELD_FIELD_METADATA_ID_VIEW_ID_BASE_UNIQUE" ON "core"."viewField" ("fieldMetadataId", "viewId") WHERE "deletedAt" IS NULL AND "subFieldName" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_VIEW_FIELD_FIELD_METADATA_ID_VIEW_ID_SUB_FIELD_NAME_UNIQUE" ON "core"."viewField" ("fieldMetadataId", "viewId", "subFieldName") WHERE "deletedAt" IS NULL AND "subFieldName" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "core"."viewField" WHERE "universalIdentifier" = $1`,
      [
        STANDARD_OBJECTS.company.views.allCompanies.viewFields.addressCountry
          .universalIdentifier,
      ],
    );
    await queryRunner.query(
      `UPDATE "core"."viewField" SET "subFieldName" = 'addressCountry', "updatedAt" = NOW() WHERE "universalIdentifier" = $1 AND "deletedAt" IS NULL`,
      [
        STANDARD_OBJECTS.company.views.allCompanies.viewFields.address
          .universalIdentifier,
      ],
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VIEW_FIELD_FIELD_METADATA_ID_VIEW_ID_SUB_FIELD_NAME_UNIQUE"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VIEW_FIELD_FIELD_METADATA_ID_VIEW_ID_BASE_UNIQUE"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_VIEW_FIELD_FIELD_METADATA_ID_VIEW_ID_UNIQUE" ON "core"."viewField" ("fieldMetadataId", "viewId") WHERE "deletedAt" IS NULL`,
    );
  }
}
