import { Injectable } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';

import { EntityManager } from 'typeorm';

import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

@Injectable()
export class LinkedinConnectionOwnersService {
  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  async refresh(workspaceId: string): Promise<void> {
    const schema = getWorkspaceSchemaName(workspaceId);

    // Compare observations within each member/person pair. The shared Person
    // state and date have no owner and cannot establish an individual connection.
    await this.entityManager.query(`
      WITH observations AS (
        SELECT "personId", "ownerWorkspaceMemberId", TRUE AS connected,
               COALESCE("connectedAt", "createdAt") AS observed_at, id
        FROM "${schema}"."linkedinConnection"
        WHERE "deletedAt" IS NULL AND "personId" IS NOT NULL AND "ownerWorkspaceMemberId" IS NOT NULL
        UNION ALL
        SELECT "personId", "ownerWorkspaceMemberId", "connectionState" = 'CONNECTED',
               COALESCE("executedAt", "updatedAt"), id
        FROM "${schema}"."linkedinAction"
        WHERE "deletedAt" IS NULL AND "personId" IS NOT NULL AND "ownerWorkspaceMemberId" IS NOT NULL
          AND status IN ('COMPLETED', 'SKIPPED') AND "connectionState" <> 'UNKNOWN'
      ), latest AS (
        SELECT DISTINCT ON ("personId", "ownerWorkspaceMemberId")
               "personId", "ownerWorkspaceMemberId", connected
        FROM observations
        ORDER BY "personId", "ownerWorkspaceMemberId", observed_at DESC, connected DESC, id
      ), members AS (
        SELECT id, NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM("nameFirstName"), ''),
                 NULLIF(TRIM("nameLastName"), ''))), '') AS name,
               COALESCE(NULLIF("userEmail", ''), id::text) AS identifier
        FROM "${schema}"."workspaceMember" WHERE "deletedAt" IS NULL
      ), member_labels AS (
        SELECT id, CASE WHEN name IS NULL THEN identifier
                        WHEN COUNT(*) OVER (PARTITION BY LOWER(name)) > 1 THEN name || ' (' || identifier || ')'
                        ELSE name END AS label
        FROM members
      ), owners AS (
        SELECT "personId", ARRAY_AGG(label ORDER BY label, member_labels.id) AS names
        FROM latest JOIN member_labels ON member_labels.id::text = "ownerWorkspaceMemberId"
        WHERE connected
        GROUP BY "personId"
      ), changes AS (
        SELECT person.id, owners.names
        FROM "${schema}".person LEFT JOIN owners ON owners."personId" = person.id
        WHERE person."deletedAt" IS NULL AND person."linkedinConnectedTo" IS DISTINCT FROM owners.names
      )
      UPDATE "${schema}".person AS person
      SET "linkedinConnectedTo" = changes.names, "updatedAt" = NOW()
      FROM changes WHERE person.id = changes.id
    `);
  }
}
