import { Injectable } from '@nestjs/common';

import { LINKEDIN_CONNECTION_STATES } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { ILike, In } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import {
  addValueToSetMap,
  getOnlySetValue,
  getPersonFullName,
  normalizeFullName,
  normalizeLinkedinHandle,
} from 'src/modules/linkedin/utils/linkedin-identity-matching.util';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

type MatchLinkedinConnectionsByIdsArgs = {
  connectionIds: string[];
  workspaceId: string;
};

type MatchLinkedinConnectionsForPeopleArgs = {
  personIds: string[];
  workspaceId: string;
};

type MatcherRepositories = {
  connectionRepository: WorkspaceRepository<LinkedinConnectionWorkspaceEntity>;
  personRepository: WorkspaceRepository<PersonWorkspaceEntity>;
};

// Connections carry their handle directly, so matching only needs a
// handle tier and a full-name fallback — unlike thread participants,
// there is no owner/URN bridge to resolve first.
@Injectable()
export class LinkedinConnectionMatcherService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  public async matchConnectionsByIds({
    connectionIds,
    workspaceId,
  }: MatchLinkedinConnectionsByIdsArgs): Promise<void> {
    const uniqueConnectionIds = [...new Set(connectionIds)];

    if (uniqueConnectionIds.length === 0) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repositories = await this.getRepositories(workspaceId);
      const connections = await repositories.connectionRepository.find({
        where: { id: In(uniqueConnectionIds) },
      });

      await this.matchConnections({ connections, repositories });
    }, buildSystemAuthContext(workspaceId));
  }

  public async matchConnectionsForPeople({
    personIds,
    workspaceId,
  }: MatchLinkedinConnectionsForPeopleArgs): Promise<void> {
    const uniquePersonIds = [...new Set(personIds)];

    if (uniquePersonIds.length === 0) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repositories = await this.getRepositories(workspaceId);
      const people = await repositories.personRepository.find({
        where: { id: In(uniquePersonIds) },
      });
      const handles = [
        ...new Set(
          people
            .map((person) =>
              normalizeLinkedinHandle(person.linkedinLink?.primaryLinkUrl),
            )
            .filter(isDefined),
        ),
      ];
      const fullNames = [
        ...new Set(people.map(getPersonFullName).filter(isDefined)),
      ];
      const connectionWhere = [
        { personId: In(uniquePersonIds) },
        ...handles.map((handle) => ({ handle: ILike(handle) })),
        ...fullNames.map((name) => ({ name: ILike(name) })),
      ];
      const connections = await repositories.connectionRepository.find({
        where: connectionWhere,
      });

      await this.matchConnections({ connections, repositories });
    }, buildSystemAuthContext(workspaceId));
  }

  private async getRepositories(
    workspaceId: string,
  ): Promise<MatcherRepositories> {
    const permissionOptions = {
      shouldBypassPermissionChecks: true,
    } as const;
    const [connectionRepository, personRepository] = await Promise.all([
      this.globalWorkspaceOrmManager.getRepository<LinkedinConnectionWorkspaceEntity>(
        workspaceId,
        'linkedinConnection',
        permissionOptions,
      ),
      this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
        workspaceId,
        'person',
        permissionOptions,
      ),
    ]);

    return { connectionRepository, personRepository };
  }

  private async matchConnections({
    connections,
    repositories,
  }: {
    connections: LinkedinConnectionWorkspaceEntity[];
    repositories: MatcherRepositories;
  }): Promise<void> {
    if (connections.length === 0) {
      return;
    }

    const handles = [
      ...new Set(
        connections
          .map(({ handle }) => normalizeLinkedinHandle(handle))
          .filter(isDefined),
      ),
    ];
    const peopleMatchingHandles =
      handles.length === 0
        ? []
        : await repositories.personRepository.find({
            where: handles.map((handle) => ({
              linkedinLink: {
                primaryLinkUrl: ILike(`%/in/${handle}%`),
              },
            })),
          });
    const personIdsByHandle = new Map<string, Set<string>>();

    for (const person of peopleMatchingHandles) {
      const handle = normalizeLinkedinHandle(
        person.linkedinLink?.primaryLinkUrl,
      );

      if (isDefined(handle) && handles.includes(handle)) {
        addValueToSetMap(personIdsByHandle, handle, person.id);
      }
    }

    const fullNames = [
      ...new Set(
        connections
          .map(({ name }) => normalizeFullName(name))
          .filter(isDefined),
      ),
    ];
    const peopleMatchingNames =
      fullNames.length === 0
        ? []
        : await repositories.personRepository
            .createQueryBuilder('person')
            .select([
              'person.id',
              'person.nameFirstName',
              'person.nameLastName',
            ])
            .where(
              `LOWER(REGEXP_REPLACE(TRIM(CONCAT_WS(' ', person.nameFirstName, person.nameLastName)), '\\s+', ' ', 'g')) IN (:...fullNames)`,
              { fullNames },
            )
            .getMany();
    const personIdsByFullName = new Map<string, Set<string>>();

    for (const person of peopleMatchingNames) {
      const fullName = getPersonFullName(person);

      if (isDefined(fullName) && fullNames.includes(fullName)) {
        addValueToSetMap(personIdsByFullName, fullName, person.id);
      }
    }

    const matchedPersonIds = new Set<string>();
    const connectionUpdates = connections.flatMap((connection) => {
      const matchedPersonId = this.resolvePersonId({
        connection,
        personIdsByFullName,
        personIdsByHandle,
      });

      if (isDefined(matchedPersonId)) {
        matchedPersonIds.add(matchedPersonId);
      }

      if (matchedPersonId === connection.personId) {
        return [];
      }

      return [
        {
          criteria: connection.id,
          partialEntity: { personId: matchedPersonId },
        },
      ];
    });

    if (connectionUpdates.length > 0) {
      await repositories.connectionRepository.updateMany(connectionUpdates);
    }

    if (matchedPersonIds.size > 0) {
      await repositories.personRepository.update(
        { id: In([...matchedPersonIds]) },
        { linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED },
      );
    }
  }

  private resolvePersonId({
    connection,
    personIdsByFullName,
    personIdsByHandle,
  }: {
    connection: LinkedinConnectionWorkspaceEntity;
    personIdsByFullName: Map<string, Set<string>>;
    personIdsByHandle: Map<string, Set<string>>;
  }): string | null {
    const directHandle = normalizeLinkedinHandle(connection.handle);

    if (isDefined(directHandle)) {
      const directHandlePersonIds = personIdsByHandle.get(directHandle);
      const directHandlePersonId = getOnlySetValue(directHandlePersonIds);

      if (isDefined(directHandlePersonId)) {
        return directHandlePersonId;
      }

      if (isDefined(directHandlePersonIds) && directHandlePersonIds.size > 1) {
        return null;
      }
    }

    const fullName = normalizeFullName(connection.name);

    if (!isDefined(fullName)) {
      return null;
    }

    const fullNamePersonIds = personIdsByFullName.get(fullName);

    return getOnlySetValue(fullNamePersonIds);
  }
}
