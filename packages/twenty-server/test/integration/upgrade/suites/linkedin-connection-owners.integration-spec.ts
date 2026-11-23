import { randomUUID } from 'node:crypto';

import { DataSource, type QueryRunner } from 'typeorm';

import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { LinkedinConnectionOwnersService } from 'src/modules/linkedin/services/linkedin-connection-owners.service';

jest.useRealTimers();

describe('LinkedIn connection attribution on People', () => {
  const workspaceId = randomUUID();
  const schema = getWorkspaceSchemaName(workspaceId);
  let dataSource: DataSource;
  let runner: QueryRunner;
  let service: LinkedinConnectionOwnersService;

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.PG_DATABASE_URL,
    }).initialize();
    runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    service = new LinkedinConnectionOwnersService(runner.manager);
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query(`
      CREATE TABLE person (id integer PRIMARY KEY, "linkedinConnectedTo" text[], "deletedAt" timestamptz, "updatedAt" timestamptz);
      CREATE TABLE "workspaceMember" (id integer PRIMARY KEY, "nameFirstName" text, "nameLastName" text, "userEmail" text, "deletedAt" timestamptz);
      CREATE TABLE "linkedinConnection" (id serial, "personId" integer, "ownerWorkspaceMemberId" text, "connectedAt" timestamptz, "createdAt" timestamptz DEFAULT now(), "deletedAt" timestamptz);
      CREATE TABLE "linkedinAction" (id serial, "personId" integer, "ownerWorkspaceMemberId" text, "connectionState" text, status text, "executedAt" timestamptz, "updatedAt" timestamptz DEFAULT now(), "deletedAt" timestamptz);
    `);
  });

  afterAll(async () => {
    await runner?.rollbackTransaction();
    await runner?.release();
    await dataSource?.destroy();
  });

  it('should independently attribute both members, one member, and unconfirmed contacts across refreshes', async () => {
    await runner.query(`
      INSERT INTO "workspaceMember" VALUES (1, 'Alex', 'Lee'), (2, 'Sam', 'Stone');
      INSERT INTO person (id) VALUES (1), (2), (3), (4), (5);
      INSERT INTO "linkedinConnection" ("personId", "ownerWorkspaceMemberId", "connectedAt")
      VALUES (1,1,'2025-01-01'), (1,1,'2025-01-01'), (1,2,'2025-01-01'), (2,1,'2025-01-01'), (4,NULL,'2025-01-01');
      INSERT INTO "linkedinAction" ("personId", "ownerWorkspaceMemberId", "connectionState", status)
      VALUES (2,2,'PENDING','COMPLETED'), (3,2,'CONNECTED','SKIPPED'), (4,1,'CONNECTED','FAILED'), (5,NULL,'CONNECTED','COMPLETED');
    `);
    const readOwners = async () => {
      const rows: { owners: string[] | null }[] = await runner.query(
        'SELECT "linkedinConnectedTo" AS owners FROM person ORDER BY id',
      );
      return rows.map(({ owners }) => owners);
    };
    await service.refresh(workspaceId);
    expect(await readOwners()).toEqual([
      ['Alex Lee', 'Sam Stone'],
      ['Alex Lee'],
      ['Sam Stone'],
      null,
      null,
    ]);

    await runner.query(`
      UPDATE "workspaceMember" SET "nameLastName" = 'Gray' WHERE id = 1;
      UPDATE "linkedinConnection" SET "deletedAt" = now() WHERE "personId" = 1 AND "ownerWorkspaceMemberId" = '2';
      INSERT INTO "linkedinAction" ("personId", "ownerWorkspaceMemberId", "connectionState", status)
      VALUES (2,1,'NOT_CONNECTED','COMPLETED');
    `);
    await service.refresh(workspaceId);
    await service.refresh(workspaceId);
    expect(await readOwners()).toEqual([
      ['Alex Gray'],
      null,
      ['Sam Stone'],
      null,
      null,
    ]);
  });
});
