import { type DataSource, type QueryRunner } from 'typeorm';

import { type UniboxLinkedinLegacyObject } from 'src/database/commands/upgrade-version-command/2-15/utils/unibox-linkedin-name-collision.util';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { escapeIdentifier } from 'src/engine/workspace-manager/workspace-migration/utils/remove-sql-injection.util';

type LegacyLinkedinObjectName = UniboxLinkedinLegacyObject['objectName'];

const STANDARD_TABLE_BY_OBJECT_NAME: Record<LegacyLinkedinObjectName, string> =
  {
    linkedinConnection: 'linkedinConnection',
    linkedinInvitation: 'linkedinInvitation',
    linkedinMessage: 'linkedinMessage',
    linkedinMessageThread: 'linkedinMessageThread',
    linkedinThreadParticipant: 'linkedinThreadParticipant',
  };

const qualifiedTable = (schemaName: string, tableName: string): string =>
  `${escapeIdentifier(schemaName)}.${escapeIdentifier(tableName)}`;

const qualifiedEnum = (
  schemaName: string,
  tableName: string,
  columnName: string,
): string =>
  `${escapeIdentifier(schemaName)}.${escapeIdentifier(`${tableName}_${columnName}_enum`)}`;

const getLegacyTableByObjectName = (
  legacyObjects: UniboxLinkedinLegacyObject[],
): Partial<Record<LegacyLinkedinObjectName, string>> =>
  Object.fromEntries(
    legacyObjects.map(({ objectName, objectMetadata }) => [
      objectName,
      computeObjectTargetTable(objectMetadata),
    ]),
  );

const tableExists = async ({
  queryRunner,
  schemaName,
  tableName,
}: {
  queryRunner: QueryRunner;
  schemaName: string;
  tableName: string;
}): Promise<boolean> => {
  const result = (await queryRunner.query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    ) AS "exists"`,
    [schemaName, tableName],
  )) as Array<{ exists: boolean }>;

  return result[0]?.exists === true;
};

const copyLegacyConnections = async ({
  legacyTableName,
  queryRunner,
  schemaName,
}: {
  legacyTableName: string;
  queryRunner: QueryRunner;
  schemaName: string;
}): Promise<void> => {
  const source = qualifiedTable(schemaName, legacyTableName);
  const targetTableName = STANDARD_TABLE_BY_OBJECT_NAME.linkedinConnection;
  const target = qualifiedTable(schemaName, targetTableName);
  const createdBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'createdBySource',
  );
  const updatedBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'updatedBySource',
  );

  await queryRunner.query(`
    INSERT INTO ${target} (
      "id", "createdAt", "updatedAt", "deletedAt",
      "createdBySource", "createdByWorkspaceMemberId", "createdByName",
      "createdByContext", "updatedBySource", "updatedByWorkspaceMemberId",
      "updatedByName", "updatedByContext", "position",
      "externalId", "ownerWorkspaceMemberId", "name", "handle", "headline",
      "profileUrlPrimaryLinkLabel", "profileUrlPrimaryLinkUrl",
      "profileUrlSecondaryLinks", "linkedinUrn", "connectedAt", "ownerLinkedinId"
    )
    SELECT
      source."id", source."createdAt", source."updatedAt", source."deletedAt",
      source."createdBySource"::text::${createdBySourceEnum},
      source."createdByWorkspaceMemberId", source."createdByName",
      source."createdByContext",
      source."updatedBySource"::text::${updatedBySourceEnum},
      source."updatedByWorkspaceMemberId", source."updatedByName",
      source."updatedByContext", source."position", source."externalId",
      COALESCE(
        source."createdByWorkspaceMemberId",
        source."updatedByWorkspaceMemberId"
      )::text,
      source."name", source."handle", source."headline",
      source."profileUrlPrimaryLinkLabel", source."profileUrlPrimaryLinkUrl",
      source."profileUrlSecondaryLinks",
      CASE
        WHEN strpos(source."externalId", ':') > 0
          THEN substring(source."externalId" FROM strpos(source."externalId", ':') + 1)
        ELSE source."externalId"
      END,
      source."connectedAt", source."ownerLinkedinId"
    FROM ${source} source
    WHERE source."externalId" IS NOT NULL
      AND source."ownerLinkedinId" IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

const copyLegacyInvitations = async ({
  legacyTableName,
  queryRunner,
  schemaName,
}: {
  legacyTableName: string;
  queryRunner: QueryRunner;
  schemaName: string;
}): Promise<void> => {
  const source = qualifiedTable(schemaName, legacyTableName);
  const targetTableName = STANDARD_TABLE_BY_OBJECT_NAME.linkedinInvitation;
  const target = qualifiedTable(schemaName, targetTableName);
  const directionEnum = qualifiedEnum(schemaName, targetTableName, 'direction');
  const createdBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'createdBySource',
  );
  const updatedBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'updatedBySource',
  );

  await queryRunner.query(`
    INSERT INTO ${target} (
      "id", "createdAt", "updatedAt", "deletedAt",
      "createdBySource", "createdByWorkspaceMemberId", "createdByName",
      "createdByContext", "updatedBySource", "updatedByWorkspaceMemberId",
      "updatedByName", "updatedByContext", "position",
      "externalId", "ownerWorkspaceMemberId", "name", "direction", "handle",
      "headline", "message", "sentAt", "ownerLinkedinId"
    )
    SELECT
      source."id", source."createdAt", source."updatedAt", source."deletedAt",
      source."createdBySource"::text::${createdBySourceEnum},
      source."createdByWorkspaceMemberId", source."createdByName",
      source."createdByContext",
      source."updatedBySource"::text::${updatedBySourceEnum},
      source."updatedByWorkspaceMemberId", source."updatedByName",
      source."updatedByContext", source."position", source."externalId",
      COALESCE(
        source."createdByWorkspaceMemberId",
        source."updatedByWorkspaceMemberId"
      )::text,
      source."name", source."direction"::text::${directionEnum}, source."handle",
      source."headline", source."message", source."sentAt", source."ownerLinkedinId"
    FROM ${source} source
    WHERE source."externalId" IS NOT NULL
      AND source."ownerLinkedinId" IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

const copyLegacyThreads = async ({
  legacyMessageTableName,
  legacyThreadTableName,
  queryRunner,
  schemaName,
}: {
  legacyMessageTableName: string | undefined;
  legacyThreadTableName: string;
  queryRunner: QueryRunner;
  schemaName: string;
}): Promise<void> => {
  const source = qualifiedTable(schemaName, legacyThreadTableName);
  const targetTableName = STANDARD_TABLE_BY_OBJECT_NAME.linkedinMessageThread;
  const target = qualifiedTable(schemaName, targetTableName);
  const createdBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'createdBySource',
  );
  const updatedBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'updatedBySource',
  );
  const messageCountExpression = legacyMessageTableName
    ? `(SELECT count(*)::double precision FROM ${qualifiedTable(
        schemaName,
        legacyMessageTableName,
      )} message WHERE message."threadExternalId" = source."externalId" AND message."deletedAt" IS NULL)`
    : '0::double precision';
  const lastMessagePreviewExpression = legacyMessageTableName
    ? `COALESCE((
        SELECT left(COALESCE(message."body", ''), 200)
        FROM ${qualifiedTable(schemaName, legacyMessageTableName)} message
        WHERE message."threadExternalId" = source."externalId"
          AND message."deletedAt" IS NULL
        ORDER BY message."deliveredAt" DESC NULLS LAST
        LIMIT 1
      ), '')`
    : "''";

  await queryRunner.query(`
    INSERT INTO ${target} (
      "id", "createdAt", "updatedAt", "deletedAt",
      "createdBySource", "createdByWorkspaceMemberId", "createdByName",
      "createdByContext", "updatedBySource", "updatedByWorkspaceMemberId",
      "updatedByName", "updatedByContext", "position",
      "externalId", "ownerWorkspaceMemberId", "name", "threadId",
      "firstMessageTime", "lastMessageTime", "labels", "ownerLinkedinId",
      "lastMessagePreview", "messageCount"
    )
    SELECT
      source."id", source."createdAt", source."updatedAt", source."deletedAt",
      source."createdBySource"::text::${createdBySourceEnum},
      source."createdByWorkspaceMemberId", source."createdByName",
      source."createdByContext",
      source."updatedBySource"::text::${updatedBySourceEnum},
      source."updatedByWorkspaceMemberId", source."updatedByName",
      source."updatedByContext", source."position", source."externalId",
      COALESCE(
        source."createdByWorkspaceMemberId",
        source."updatedByWorkspaceMemberId"
      )::text,
      source."name", source."threadId", source."firstMessageTime",
      source."lastMessageTime", COALESCE(source."labels", '[]'::jsonb),
      source."ownerLinkedinId", ${lastMessagePreviewExpression},
      ${messageCountExpression}
    FROM ${source} source
    WHERE source."externalId" IS NOT NULL
      AND source."threadId" IS NOT NULL
      AND source."ownerLinkedinId" IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

const copyLegacyMessages = async ({
  legacyMessageTableName,
  legacyThreadTableName,
  queryRunner,
  schemaName,
}: {
  legacyMessageTableName: string;
  legacyThreadTableName: string | undefined;
  queryRunner: QueryRunner;
  schemaName: string;
}): Promise<void> => {
  const source = qualifiedTable(schemaName, legacyMessageTableName);
  const targetTableName = STANDARD_TABLE_BY_OBJECT_NAME.linkedinMessage;
  const target = qualifiedTable(schemaName, targetTableName);
  const targetThread = qualifiedTable(
    schemaName,
    STANDARD_TABLE_BY_OBJECT_NAME.linkedinMessageThread,
  );
  const directionEnum = qualifiedEnum(schemaName, targetTableName, 'direction');
  const createdBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'createdBySource',
  );
  const updatedBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'updatedBySource',
  );
  const legacyThreadJoin = legacyThreadTableName
    ? `LEFT JOIN ${qualifiedTable(schemaName, legacyThreadTableName)} legacy_thread
         ON legacy_thread."externalId" = source."threadExternalId"`
    : '';
  const senderLinkedinUrnExpression = legacyThreadTableName
    ? `(SELECT participant ->> 'linkedinUrn'
        FROM jsonb_array_elements(
          COALESCE(legacy_thread."participants", '[]'::jsonb)
        ) participant
        WHERE participant ->> 'name' = source."senderName"
        LIMIT 1)`
    : 'NULL::text';

  await queryRunner.query(`
    INSERT INTO ${target} (
      "id", "createdAt", "updatedAt", "deletedAt",
      "createdBySource", "createdByWorkspaceMemberId", "createdByName",
      "createdByContext", "updatedBySource", "updatedByWorkspaceMemberId",
      "updatedByName", "updatedByContext", "position",
      "externalId", "ownerWorkspaceMemberId", "messageId", "body",
      "deliveredAt", "direction", "senderName", "senderLinkedinUrn",
      "ownerLinkedinId", "threadId"
    )
    SELECT
      source."id", source."createdAt", source."updatedAt", source."deletedAt",
      source."createdBySource"::text::${createdBySourceEnum},
      source."createdByWorkspaceMemberId", source."createdByName",
      source."createdByContext",
      source."updatedBySource"::text::${updatedBySourceEnum},
      source."updatedByWorkspaceMemberId", source."updatedByName",
      source."updatedByContext", source."position", source."externalId",
      COALESCE(
        source."createdByWorkspaceMemberId",
        source."updatedByWorkspaceMemberId"
      )::text,
      source."messageId", COALESCE(source."body", ''), source."deliveredAt",
      source."direction"::text::${directionEnum}, COALESCE(source."senderName", ''),
      ${senderLinkedinUrnExpression}, source."ownerLinkedinId", target_thread."id"
    FROM ${source} source
    JOIN ${targetThread} target_thread
      ON target_thread."externalId" = source."threadExternalId"
    ${legacyThreadJoin}
    WHERE source."externalId" IS NOT NULL
      AND source."messageId" IS NOT NULL
      AND source."deliveredAt" IS NOT NULL
      AND source."ownerLinkedinId" IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

const copyLegacyThreadParticipants = async ({
  legacyThreadTableName,
  queryRunner,
  schemaName,
}: {
  legacyThreadTableName: string;
  queryRunner: QueryRunner;
  schemaName: string;
}): Promise<void> => {
  const source = qualifiedTable(schemaName, legacyThreadTableName);
  const targetTableName =
    STANDARD_TABLE_BY_OBJECT_NAME.linkedinThreadParticipant;
  const target = qualifiedTable(schemaName, targetTableName);
  const createdBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'createdBySource',
  );
  const updatedBySourceEnum = qualifiedEnum(
    schemaName,
    targetTableName,
    'updatedBySource',
  );
  const targetThread = qualifiedTable(
    schemaName,
    STANDARD_TABLE_BY_OBJECT_NAME.linkedinMessageThread,
  );

  await queryRunner.query(`
    INSERT INTO ${target} (
      "id", "createdAt", "updatedAt", "deletedAt",
      "createdBySource", "createdByWorkspaceMemberId", "createdByName",
      "createdByContext", "updatedBySource", "updatedByWorkspaceMemberId",
      "updatedByName", "updatedByContext", "position",
      "externalId", "ownerWorkspaceMemberId", "linkedinUrn",
      "linkedinMemberId", "name", "headline", "isSelf", "threadId"
    )
    SELECT
      uuid_generate_v4(), source."createdAt", source."updatedAt", NULL,
      source."createdBySource"::text::${createdBySourceEnum},
      source."createdByWorkspaceMemberId", source."createdByName",
      source."createdByContext",
      source."updatedBySource"::text::${updatedBySourceEnum},
      source."updatedByWorkspaceMemberId", source."updatedByName",
      source."updatedByContext", source."position",
      concat(
        source."ownerLinkedinId", ':', source."threadId", ':',
        COALESCE(
          participant ->> 'linkedinUrn',
          participant ->> 'linkedinId',
          lower(participant ->> 'name')
        )
      ),
      COALESCE(
        source."createdByWorkspaceMemberId",
        source."updatedByWorkspaceMemberId"
      )::text,
      participant ->> 'linkedinUrn', participant ->> 'linkedinId',
      COALESCE(participant ->> 'name', 'LinkedIn member'),
      participant ->> 'headline',
      participant ->> 'linkedinId' = source."ownerLinkedinId",
      target_thread."id"
    FROM ${source} source
    JOIN ${targetThread} target_thread
      ON target_thread."externalId" = source."externalId"
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(source."participants", '[]'::jsonb)
    ) participant
    WHERE source."externalId" IS NOT NULL
      AND source."threadId" IS NOT NULL
      AND source."ownerLinkedinId" IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

export const migrateLegacyLinkedinData = async ({
  dataSource,
  legacyObjects,
  workspaceId,
}: {
  dataSource: DataSource;
  legacyObjects: UniboxLinkedinLegacyObject[];
  workspaceId: string;
}): Promise<void> => {
  if (legacyObjects.length === 0) {
    return;
  }

  const schemaName = getWorkspaceSchemaName(workspaceId);
  const legacyTableByObjectName = getLegacyTableByObjectName(legacyObjects);
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    for (const tableName of Object.values(STANDARD_TABLE_BY_OBJECT_NAME)) {
      if (!(await tableExists({ queryRunner, schemaName, tableName }))) {
        throw new Error(
          `Cannot migrate legacy LinkedIn data because ${schemaName}.${tableName} does not exist`,
        );
      }
    }

    const connectionTable = legacyTableByObjectName.linkedinConnection;
    const invitationTable = legacyTableByObjectName.linkedinInvitation;
    const threadTable = legacyTableByObjectName.linkedinMessageThread;
    const messageTable = legacyTableByObjectName.linkedinMessage;

    if (connectionTable) {
      await copyLegacyConnections({
        legacyTableName: connectionTable,
        queryRunner,
        schemaName,
      });
    }

    if (invitationTable) {
      await copyLegacyInvitations({
        legacyTableName: invitationTable,
        queryRunner,
        schemaName,
      });
    }

    if (threadTable) {
      await copyLegacyThreads({
        legacyMessageTableName: messageTable,
        legacyThreadTableName: threadTable,
        queryRunner,
        schemaName,
      });
    }

    if (messageTable) {
      await copyLegacyMessages({
        legacyMessageTableName: messageTable,
        legacyThreadTableName: threadTable,
        queryRunner,
        schemaName,
      });
    }

    if (threadTable) {
      await copyLegacyThreadParticipants({
        legacyThreadTableName: threadTable,
        queryRunner,
        schemaName,
      });
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
};
