import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { FieldActorSource, RECORD_LIST_TYPES } from 'twenty-shared/types';

import { type AddUniboxContactsToCrmOutputDTO } from 'src/engine/core-modules/unibox/dtos/add-unibox-contacts-to-crm-output.dto';
import { type AddUniboxContactsToCrmInput } from 'src/engine/core-modules/unibox/dtos/add-unibox-contacts-to-crm.input';
import { type UniboxContactsWithTotalDTO } from 'src/engine/core-modules/unibox/dtos/unibox-contacts-with-total.dto';
import { type UniboxContactsInput } from 'src/engine/core-modules/unibox/dtos/unibox-contacts.input';
import { UniboxContactCrmFilter } from 'src/engine/core-modules/unibox/enums/unibox-contact-crm-filter.enum';
import { UniboxContactSince } from 'src/engine/core-modules/unibox/enums/unibox-contact-since.enum';
import {
  type OwnedEmailChannelContext,
  UniboxEmailChannelService,
} from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import {
  getUniboxContactCrmHavingClause,
  getUniboxContactsSinceDate,
  getUniboxPageOffset,
  normalizeUniboxContactHandles,
} from 'src/engine/core-modules/unibox/utils/unibox-query.utils';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CreateCompanyAndPersonService } from 'src/modules/contact-creation-manager/services/create-company-and-contact.service';
import { type Contact } from 'src/modules/contact-creation-manager/types/contact.type';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { addPersonEmailFiltersToQueryBuilder } from 'src/modules/match-participant/utils/add-person-email-filters-to-query-builder';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

type GetUniboxContactsArgs = {
  input: UniboxContactsInput;
  workspaceId: string;
  userWorkspaceId: string;
};

type AddUniboxContactsToCrmArgs = {
  input: AddUniboxContactsToCrmInput;
  workspaceId: string;
  userWorkspaceId: string;
  workspaceMemberId: string;
};

type ContactAggregateRawRow = {
  handle: string;
  displayName: string | null;
  personId: string | null;
  messageCount: string | number;
  lastContactedAt: Date | string;
  firstContactedAt: Date | string;
  latestMessageChannelId: string;
  totalCount: string | number;
};

const EMPTY_UNIBOX_CONTACTS: UniboxContactsWithTotalDTO = {
  totalCount: 0,
  contacts: [],
};

@Injectable()
export class UniboxContactsService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly uniboxEmailChannelService: UniboxEmailChannelService,
    private readonly createCompanyAndPersonService: CreateCompanyAndPersonService,
    private readonly matchParticipantService: MatchParticipantService<MessageParticipantWorkspaceEntity>,
  ) {}

  async getContacts({
    input,
    workspaceId,
    userWorkspaceId,
  }: GetUniboxContactsArgs): Promise<UniboxContactsWithTotalDTO> {
    const ownedChannelContext =
      await this.uniboxEmailChannelService.getOwnedEmailChannelContext({
        workspaceId,
        userWorkspaceId,
      });

    if (ownedChannelContext.channelIds.length === 0) {
      return EMPTY_UNIBOX_CONTACTS;
    }

    const { rows, totalCount } = await this.getContactRows({
      workspaceId,
      ownedChannelContext,
      input,
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 30,
    });

    return {
      totalCount,
      contacts: rows.map((row) => ({
        handle: row.handle,
        displayName: row.displayName?.trim() || row.handle,
        secondaryLabel: null,
        personId: row.personId,
        messageCount: Number(row.messageCount),
        lastContactedAt: new Date(row.lastContactedAt),
        firstContactedAt: new Date(row.firstContactedAt),
      })),
    };
  }

  async addContactsToCrm({
    input,
    workspaceId,
    userWorkspaceId,
    workspaceMemberId,
  }: AddUniboxContactsToCrmArgs): Promise<AddUniboxContactsToCrmOutputDTO> {
    const hasExplicitHandles = input.handles !== undefined;
    const hasFilter = input.filter !== undefined;

    if (hasExplicitHandles === hasFilter) {
      throw new BadRequestException(
        'Provide either handles or a contact filter, but not both',
      );
    }

    const requestedHandles = normalizeUniboxContactHandles(input.handles ?? []);
    const excludedHandles = normalizeUniboxContactHandles(
      input.excludedHandles ?? [],
    );

    if (hasExplicitHandles && requestedHandles.length === 0) {
      return {
        createdPersonCount: 0,
        alreadyExistingCount: 0,
        personIds: [],
      };
    }

    const ownedChannelContext =
      await this.uniboxEmailChannelService.getOwnedEmailChannelContext({
        workspaceId,
        userWorkspaceId,
      });

    if (ownedChannelContext.channelIds.length === 0) {
      return {
        createdPersonCount: 0,
        alreadyExistingCount: 0,
        personIds: [],
      };
    }

    if (input.recordListId) {
      await this.validatePersonRecordList({
        workspaceId,
        recordListId: input.recordListId,
      });
    }

    const { rows: eligibleContactRows } = await this.getContactRows({
      workspaceId,
      ownedChannelContext,
      handles: hasExplicitHandles ? requestedHandles : undefined,
      excludedHandles,
      input: input.filter ?? {
        inCrmFilter: UniboxContactCrmFilter.ALL,
        since: UniboxContactSince.LIFETIME,
      },
    });
    const eligibleHandles = eligibleContactRows.map((row) => row.handle);

    if (eligibleHandles.length === 0) {
      return {
        createdPersonCount: 0,
        alreadyExistingCount: 0,
        personIds: [],
      };
    }

    const { activePeople: activePeopleBefore, workspaceMember } =
      await this.getPeopleAndWorkspaceMember({
        workspaceId,
        workspaceMemberId,
        handles: eligibleHandles,
      });

    if (!workspaceMember) {
      throw new ForbiddenException('Workspace member not found');
    }

    const contactsByConnectedAccountId = new Map<string, Contact[]>();

    for (const contactRow of eligibleContactRows) {
      const connectedAccountId =
        ownedChannelContext.connectedAccountIdByChannelId.get(
          contactRow.latestMessageChannelId,
        );

      if (!connectedAccountId) {
        continue;
      }

      const contact = {
        handle: contactRow.handle,
        displayName: contactRow.displayName?.trim() || contactRow.handle,
      };
      const accountContacts =
        contactsByConnectedAccountId.get(connectedAccountId);

      if (accountContacts) {
        accountContacts.push(contact);
      } else {
        contactsByConnectedAccountId.set(connectedAccountId, [contact]);
      }
    }

    const accountById = new Map(
      ownedChannelContext.accounts.map((account) => [account.id, account]),
    );

    for (const [connectedAccountId, contacts] of contactsByConnectedAccountId) {
      const connectedAccount = accountById.get(connectedAccountId);

      if (!connectedAccount) {
        continue;
      }

      await this.createCompanyAndPersonService.createCompaniesAndPeople(
        connectedAccount,
        contacts,
        workspaceId,
        FieldActorSource.MANUAL,
        workspaceMember,
      );
    }

    const { activePeople: activePeopleAfter } =
      await this.getPeopleAndWorkspaceMember({
        workspaceId,
        workspaceMemberId,
        handles: eligibleHandles,
      });
    const personIds = [
      ...new Set(activePeopleAfter.map((person) => person.id)),
    ];
    const activePersonIdsBefore = new Set(
      activePeopleBefore.map((person) => person.id),
    );

    if (personIds.length > 0) {
      await this.matchParticipantService.matchParticipantsForPeople({
        participantMatching: {
          personIds,
          personEmails: eligibleHandles,
        },
        objectMetadataName: 'messageParticipant',
        workspaceId,
      });
    }

    if (input.recordListId && personIds.length > 0) {
      await this.addPeopleToRecordList({
        workspaceId,
        recordListId: input.recordListId,
        personIds,
      });
    }

    return {
      createdPersonCount: personIds.filter(
        (personId) => !activePersonIdsBefore.has(personId),
      ).length,
      alreadyExistingCount: activePersonIdsBefore.size,
      personIds,
    };
  }

  private async getContactRows({
    workspaceId,
    ownedChannelContext,
    input,
    handles,
    excludedHandles,
    page,
    pageSize,
  }: {
    workspaceId: string;
    ownedChannelContext: OwnedEmailChannelContext;
    input: Pick<
      UniboxContactsInput,
      | 'afterHandle'
      | 'afterLastContactedAt'
      | 'inCrmFilter'
      | 'search'
      | 'since'
    >;
    handles?: string[];
    excludedHandles?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ rows: ContactAggregateRawRow[]; totalCount: number }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageParticipantRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
            workspaceId,
            'messageParticipant',
            { shouldBypassPermissionChecks: true },
          );
        const messageDateExpression =
          'COALESCE("message"."receivedAt", "message"."createdAt")';
        const query = messageParticipantRepository
          .createQueryBuilder('messageParticipant')
          .select('LOWER("messageParticipant"."handle")', 'handle')
          .addSelect(
            `(ARRAY_AGG(NULLIF(BTRIM("messageParticipant"."displayName"), '') ORDER BY ${messageDateExpression} DESC, "message"."id" DESC) FILTER (WHERE NULLIF(BTRIM("messageParticipant"."displayName"), '') IS NOT NULL))[1]`,
            'displayName',
          )
          .addSelect('MAX("messageParticipant"."personId"::text)', 'personId')
          .addSelect('COUNT(DISTINCT "message"."id")::int', 'messageCount')
          .addSelect(`MAX(${messageDateExpression})`, 'lastContactedAt')
          .addSelect(`MIN(${messageDateExpression})`, 'firstContactedAt')
          .addSelect(
            `(ARRAY_AGG("association"."messageChannelId" ORDER BY ${messageDateExpression} DESC, "message"."id" DESC, "association"."id" DESC))[1]`,
            'latestMessageChannelId',
          )
          .addSelect('COUNT(*) OVER()', 'totalCount')
          .innerJoin('messageParticipant.message', 'message')
          .innerJoin('message.messageChannelMessageAssociations', 'association')
          .where('"association"."messageChannelId" IN (:...channelIds)', {
            channelIds: ownedChannelContext.channelIds,
          })
          // A counterpart is anyone on a message in the user's channels who is
          // not the user, whatever the direction or role. Restricting to
          // outgoing recipients would hide every inbound sender, and restricting
          // to senders would hide everyone merely copied on a received thread.
          // The workspace-member and owned-handle filters below exclude the user.
          .andWhere('"messageParticipant"."workspaceMemberId" IS NULL')
          .andWhere('"messageParticipant"."handle" IS NOT NULL')
          .andWhere('BTRIM("messageParticipant"."handle") <> \'\'')
          .groupBy('LOWER("messageParticipant"."handle")')
          .orderBy(`MAX(${messageDateExpression})`, 'DESC')
          .addOrderBy('LOWER("messageParticipant"."handle")', 'ASC');

        if (ownedChannelContext.ownedHandles.length > 0) {
          query.andWhere(
            'LOWER("messageParticipant"."handle") NOT IN (:...ownedHandles)',
            { ownedHandles: ownedChannelContext.ownedHandles },
          );
        }

        if (handles?.length) {
          query.andWhere(
            'LOWER("messageParticipant"."handle") IN (:...handles)',
            { handles },
          );
        }

        if (excludedHandles?.length) {
          query.andWhere(
            'LOWER("messageParticipant"."handle") NOT IN (:...excludedHandles)',
            { excludedHandles },
          );
        }

        const sinceDate = getUniboxContactsSinceDate(
          input.since ?? UniboxContactSince.LIFETIME,
        );

        if (sinceDate) {
          query.andWhere(`${messageDateExpression} >= :sinceDate`, {
            sinceDate,
          });
        }

        const crmFilter =
          input.inCrmFilter ?? UniboxContactCrmFilter.NOT_IN_CRM;

        const crmHavingClause = getUniboxContactCrmHavingClause(crmFilter);

        if (crmHavingClause) {
          query.having(crmHavingClause);
        }

        const normalizedSearch = input.search?.trim();

        if (normalizedSearch) {
          query.andHaving(
            '(LOWER("messageParticipant"."handle") ILIKE :search OR BOOL_OR("messageParticipant"."displayName" ILIKE :search))',
            { search: `%${normalizedSearch}%` },
          );
        }

        const hasCursor =
          input.afterLastContactedAt !== undefined &&
          input.afterHandle !== undefined;

        if (hasCursor) {
          query.andHaving(
            `(
              MAX(${messageDateExpression}) < :afterLastContactedAt
              OR (
                MAX(${messageDateExpression}) = :afterLastContactedAt
                AND LOWER("messageParticipant"."handle") > :afterHandle
              )
            )`,
            {
              afterLastContactedAt: input.afterLastContactedAt,
              afterHandle: input.afterHandle,
            },
          );
        }

        if (page && pageSize) {
          if (!hasCursor) {
            query.offset(getUniboxPageOffset(page, pageSize));
          }

          query.limit(pageSize);
        }

        const rows = await query.getRawMany<ContactAggregateRawRow>();

        return {
          rows,
          totalCount: Number(rows[0]?.totalCount ?? 0),
        };
      },
      authContext,
    );
  }

  private async getPeopleAndWorkspaceMember({
    workspaceId,
    workspaceMemberId,
    handles,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    handles: string[];
  }): Promise<{
    activePeople: PersonWorkspaceEntity[];
    workspaceMember: WorkspaceMemberWorkspaceEntity | null;
  }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
            workspaceId,
            'person',
            { shouldBypassPermissionChecks: true },
          );
        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberWorkspaceEntity>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );
        const people = await addPersonEmailFiltersToQueryBuilder({
          queryBuilder: personRepository.createQueryBuilder('person'),
          emails: handles,
        })
          .orderBy('person.createdAt', 'ASC')
          .getMany();
        const workspaceMember = await workspaceMemberRepository.findOne({
          where: { id: workspaceMemberId },
        });

        return {
          activePeople: people.filter((person) => person.deletedAt === null),
          workspaceMember,
        };
      },
      authContext,
    );
  }

  private async addPeopleToRecordList({
    workspaceId,
    recordListId,
    personIds,
  }: {
    workspaceId: string;
    recordListId: string;
    personIds: string[];
  }): Promise<void> {
    await this.validatePersonRecordList({ workspaceId, recordListId });

    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const recordListMemberRepository =
        await this.globalWorkspaceOrmManager.getRepository<RecordListMemberWorkspaceEntity>(
          workspaceId,
          'recordListMember',
          { shouldBypassPermissionChecks: true },
        );
      await recordListMemberRepository.upsert(
        personIds.map((personId) => ({
          recordListId,
          targetPersonId: personId,
          position: 0,
        })),
        {
          conflictPaths: ['targetPersonId', 'recordListId'],
          indexPredicate:
            '"deletedAt" IS NULL AND "targetPersonId" IS NOT NULL',
          skipUpdateIfNoValuesChanged: true,
        },
      );
    }, authContext);
  }

  private async validatePersonRecordList({
    workspaceId,
    recordListId,
  }: {
    workspaceId: string;
    recordListId: string;
  }): Promise<void> {
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const recordListRepository =
        await this.globalWorkspaceOrmManager.getRepository<RecordListWorkspaceEntity>(
          workspaceId,
          'recordList',
          { shouldBypassPermissionChecks: true },
        );
      const recordList = await recordListRepository.findOne({
        where: { id: recordListId },
        select: { id: true, type: true },
      });

      if (!recordList) {
        throw new BadRequestException('Record list not found');
      }

      if (recordList.type !== RECORD_LIST_TYPES.PERSON) {
        throw new BadRequestException(
          'Unibox contacts can only be added to contact lists',
        );
      }
    }, authContext);
  }
}
