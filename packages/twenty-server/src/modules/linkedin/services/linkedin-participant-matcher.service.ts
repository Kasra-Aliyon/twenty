import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { ILike, In, type FindOptionsWhere } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { type LinkedinMessageThreadWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message-thread.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const LINKEDIN_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

type MatchLinkedinThreadParticipantsArgs = {
  participantIds: string[];
  workspaceId: string;
};

type MatchLinkedinThreadParticipantsForPeopleArgs = {
  personIds: string[];
  workspaceId: string;
};

type MatcherRepositories = {
  connectionRepository: WorkspaceRepository<LinkedinConnectionWorkspaceEntity>;
  participantRepository: WorkspaceRepository<LinkedinThreadParticipantWorkspaceEntity>;
  personRepository: WorkspaceRepository<PersonWorkspaceEntity>;
  threadRepository: WorkspaceRepository<LinkedinMessageThreadWorkspaceEntity>;
};

const normalizeLinkedinHandle = (
  value: string | null | undefined,
): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const trimmedValue = value.trim();
  const linkedinPathMatch = trimmedValue.match(/(?:^|\/)in\/([^/?#]+)/i);
  const handleWithPossibleEncoding = linkedinPathMatch?.[1]
    ? linkedinPathMatch[1]
    : trimmedValue.replace(/^@/, '').split(/[/?#]/, 1)[0];

  let handle: string;

  try {
    handle = decodeURIComponent(handleWithPossibleEncoding).toLowerCase();
  } catch {
    return null;
  }

  return LINKEDIN_HANDLE_PATTERN.test(handle) ? handle : null;
};

const normalizeFullName = (value: string | null | undefined): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedName = value.trim().replace(/\s+/g, ' ').toLowerCase();

  return normalizedName.split(' ').length > 1 ? normalizedName : null;
};

const getPersonFullName = (person: PersonWorkspaceEntity): string | null =>
  normalizeFullName(
    [person.name?.firstName, person.name?.lastName]
      .filter(isNonEmptyString)
      .join(' '),
  );

const addValueToSetMap = (
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void => {
  const existingValues = map.get(key) ?? new Set<string>();

  existingValues.add(value);
  map.set(key, existingValues);
};

const getOwnerUrnKey = (ownerLinkedinId: string, linkedinUrn: string) =>
  `${ownerLinkedinId}\u0000${linkedinUrn}`;

const getOnlySetValue = (values: Set<string> | undefined): string | null =>
  values?.size === 1 ? ([...values][0] ?? null) : null;

@Injectable()
export class LinkedinParticipantMatcherService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  public async matchParticipantsByIds({
    participantIds,
    workspaceId,
  }: MatchLinkedinThreadParticipantsArgs): Promise<void> {
    const uniqueParticipantIds = [...new Set(participantIds)];

    if (uniqueParticipantIds.length === 0) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repositories = await this.getRepositories(workspaceId);
      const participants = await repositories.participantRepository.find({
        where: { id: In(uniqueParticipantIds) },
      });

      await this.matchParticipants({ participants, repositories });
    }, buildSystemAuthContext(workspaceId));
  }

  public async matchParticipantsForPeople({
    personIds,
    workspaceId,
  }: MatchLinkedinThreadParticipantsForPeopleArgs): Promise<void> {
    const uniquePersonIds = [...new Set(personIds)];

    if (uniquePersonIds.length === 0) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repositories = await this.getRepositories(workspaceId);
      const people = await repositories.personRepository.find({
        where: { id: In(uniquePersonIds) },
        select: ['id', 'linkedinLink', 'name'],
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
      const matchingConnections =
        handles.length === 0
          ? []
          : await repositories.connectionRepository.find({
              where: handles.map((handle) => ({ handle: ILike(handle) })),
              select: ['handle', 'linkedinUrn', 'ownerLinkedinId'],
            });
      const linkedinUrns = [
        ...new Set(
          matchingConnections
            .filter(({ handle }) =>
              handles.includes(normalizeLinkedinHandle(handle) ?? ''),
            )
            .map(({ linkedinUrn }) => linkedinUrn)
            .filter(isNonEmptyString),
        ),
      ];
      const participantWhere: FindOptionsWhere<LinkedinThreadParticipantWorkspaceEntity>[] =
        [
          { personId: In(uniquePersonIds) },
          ...handles.map((handle) => ({ handle: ILike(handle) })),
          ...fullNames.map((name) => ({ name: ILike(name) })),
          ...(linkedinUrns.length > 0
            ? [{ linkedinUrn: In(linkedinUrns) }]
            : []),
        ];
      const participants = await repositories.participantRepository.find({
        where: participantWhere,
      });

      await this.matchParticipants({ participants, repositories });
    }, buildSystemAuthContext(workspaceId));
  }

  private async getRepositories(
    workspaceId: string,
  ): Promise<MatcherRepositories> {
    const permissionOptions = {
      shouldBypassPermissionChecks: true,
    } as const;
    const [
      connectionRepository,
      participantRepository,
      personRepository,
      threadRepository,
    ] = await Promise.all([
      this.globalWorkspaceOrmManager.getRepository<LinkedinConnectionWorkspaceEntity>(
        workspaceId,
        'linkedinConnection',
        permissionOptions,
      ),
      this.globalWorkspaceOrmManager.getRepository<LinkedinThreadParticipantWorkspaceEntity>(
        workspaceId,
        'linkedinThreadParticipant',
        permissionOptions,
      ),
      this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
        workspaceId,
        'person',
        permissionOptions,
      ),
      this.globalWorkspaceOrmManager.getRepository<LinkedinMessageThreadWorkspaceEntity>(
        workspaceId,
        'linkedinMessageThread',
        permissionOptions,
      ),
    ]);

    return {
      connectionRepository,
      participantRepository,
      personRepository,
      threadRepository,
    };
  }

  private async matchParticipants({
    participants,
    repositories,
  }: {
    participants: LinkedinThreadParticipantWorkspaceEntity[];
    repositories: MatcherRepositories;
  }): Promise<void> {
    if (participants.length === 0) {
      return;
    }

    const threadIds = [
      ...new Set(
        participants.map(({ threadId }) => threadId).filter(isNonEmptyString),
      ),
    ];
    const threads =
      threadIds.length === 0
        ? []
        : await repositories.threadRepository.find({
            where: { id: In(threadIds) },
            select: ['id', 'ownerLinkedinId'],
          });
    const ownerLinkedinIdByThreadId = new Map<string, string>(
      threads.map(({ id, ownerLinkedinId }) => [id, ownerLinkedinId]),
    );
    const connectionWhereByOwnerUrn = new Map<
      string,
      FindOptionsWhere<LinkedinConnectionWorkspaceEntity>
    >();

    for (const participant of participants) {
      const ownerLinkedinId = ownerLinkedinIdByThreadId.get(
        participant.threadId,
      );
      const linkedinUrn = participant.linkedinUrn;

      if (
        participant.isSelf ||
        !isNonEmptyString(ownerLinkedinId) ||
        !isNonEmptyString(linkedinUrn)
      ) {
        continue;
      }

      connectionWhereByOwnerUrn.set(
        getOwnerUrnKey(ownerLinkedinId, linkedinUrn),
        { linkedinUrn, ownerLinkedinId },
      );
    }

    const connectionWhere = [...connectionWhereByOwnerUrn.values()];
    const connections =
      connectionWhere.length === 0
        ? []
        : await repositories.connectionRepository.find({
            where: connectionWhere,
            select: ['handle', 'linkedinUrn', 'ownerLinkedinId'],
          });
    const connectionHandlesByOwnerUrn = new Map<string, Set<string>>();

    for (const connection of connections) {
      const handle = normalizeLinkedinHandle(connection.handle);

      if (
        !isDefined(handle) ||
        !isNonEmptyString(connection.linkedinUrn) ||
        !isNonEmptyString(connection.ownerLinkedinId)
      ) {
        continue;
      }

      addValueToSetMap(
        connectionHandlesByOwnerUrn,
        getOwnerUrnKey(connection.ownerLinkedinId, connection.linkedinUrn),
        handle,
      );
    }

    const participantHandles = participants
      .filter(({ isSelf }) => !isSelf)
      .map(({ handle }) => normalizeLinkedinHandle(handle))
      .filter(isDefined);
    const connectionHandles = [...connectionHandlesByOwnerUrn.values()].flatMap(
      (handles) => [...handles],
    );
    const handles = [...new Set([...participantHandles, ...connectionHandles])];
    const peopleMatchingHandles =
      handles.length === 0
        ? []
        : await repositories.personRepository.find({
            where: handles.map((handle) => ({
              linkedinLink: {
                primaryLinkUrl: ILike(`%/in/${handle}%`),
              },
            })),
            select: ['id', 'linkedinLink'],
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
        participants
          .filter(({ isSelf }) => !isSelf)
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

    const participantUpdates = participants.flatMap((participant) => {
      const matchedPersonId = participant.isSelf
        ? null
        : this.resolvePersonId({
            participant,
            ownerLinkedinId: ownerLinkedinIdByThreadId.get(
              participant.threadId,
            ),
            connectionHandlesByOwnerUrn,
            personIdsByFullName,
            personIdsByHandle,
          });

      if (matchedPersonId === participant.personId) {
        return [];
      }

      return [
        {
          criteria: participant.id,
          partialEntity: { personId: matchedPersonId },
        },
      ];
    });

    if (participantUpdates.length > 0) {
      await repositories.participantRepository.updateMany(participantUpdates);
    }
  }

  private resolvePersonId({
    participant,
    ownerLinkedinId,
    connectionHandlesByOwnerUrn,
    personIdsByFullName,
    personIdsByHandle,
  }: {
    participant: LinkedinThreadParticipantWorkspaceEntity;
    ownerLinkedinId: string | undefined;
    connectionHandlesByOwnerUrn: Map<string, Set<string>>;
    personIdsByFullName: Map<string, Set<string>>;
    personIdsByHandle: Map<string, Set<string>>;
  }): string | null {
    const directHandle = normalizeLinkedinHandle(participant.handle);

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

    const linkedinUrn = participant.linkedinUrn;

    if (isNonEmptyString(ownerLinkedinId) && isNonEmptyString(linkedinUrn)) {
      const connectionHandles = connectionHandlesByOwnerUrn.get(
        getOwnerUrnKey(ownerLinkedinId, linkedinUrn),
      );
      const connectionHandle = getOnlySetValue(connectionHandles);

      if (isDefined(connectionHandle)) {
        const connectionHandlePersonIds =
          personIdsByHandle.get(connectionHandle);
        const connectionHandlePersonId = getOnlySetValue(
          connectionHandlePersonIds,
        );

        if (isDefined(connectionHandlePersonId)) {
          return connectionHandlePersonId;
        }

        if (
          isDefined(connectionHandlePersonIds) &&
          connectionHandlePersonIds.size > 1
        ) {
          return null;
        }
      } else if (isDefined(connectionHandles) && connectionHandles.size > 1) {
        return null;
      }
    }

    const fullName = normalizeFullName(participant.name);

    if (!isDefined(fullName)) {
      return null;
    }

    const fullNamePersonIds = personIdsByFullName.get(fullName);

    return getOnlySetValue(fullNamePersonIds);
  }
}
