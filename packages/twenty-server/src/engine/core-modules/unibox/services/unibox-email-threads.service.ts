import { Injectable } from '@nestjs/common';

import {
  type MessageParticipantRole,
  RECORD_LIST_TYPES,
} from 'twenty-shared/types';

import { UNIBOX_MESSAGE_PREVIEW_LENGTH } from 'src/engine/core-modules/unibox/constants/unibox.constants';
import { type UniboxThreadParticipantDTO } from 'src/engine/core-modules/unibox/dtos/unibox-thread-participant.dto';
import { type UniboxThreadsWithTotalDTO } from 'src/engine/core-modules/unibox/dtos/unibox-threads-with-total.dto';
import { type UniboxThreadsInput } from 'src/engine/core-modules/unibox/dtos/unibox-threads.input';
import { UniboxChannel } from 'src/engine/core-modules/unibox/enums/unibox-channel.enum';
import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';
import { UniboxEmailChannelService } from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import {
  getUniboxEmailFolderQueryConfig,
  getUniboxPageOffset,
} from 'src/engine/core-modules/unibox/utils/unibox-query.utils';
import { RelatedPersonIdsService } from 'src/engine/core-modules/related-person-ids/services/related-person-ids.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageThreadWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-thread.workspace-entity';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';

type GetUniboxThreadsArgs = {
  input: UniboxThreadsInput;
  workspaceId: string;
  userWorkspaceId: string;
};

type UniboxThreadRawRow = {
  id: string;
  subject: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | string;
  messageCount: string | number;
  lastMessageChannelId: string;
};

type UniboxThreadParticipantRawRow = {
  threadId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  personId: string | null;
};

const EMPTY_UNIBOX_THREADS: UniboxThreadsWithTotalDTO = {
  totalCount: 0,
  threads: [],
};

@Injectable()
export class UniboxEmailThreadsService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly uniboxEmailChannelService: UniboxEmailChannelService,
    private readonly relatedPersonIdsService: RelatedPersonIdsService,
  ) {}

  async getThreads({
    input,
    workspaceId,
    userWorkspaceId,
  }: GetUniboxThreadsArgs): Promise<UniboxThreadsWithTotalDTO> {
    const channel = input.channel ?? UniboxChannel.EMAIL;
    const folder = input.folder ?? UniboxFolder.INBOX;

    if (
      channel !== UniboxChannel.EMAIL ||
      folder === UniboxFolder.DRAFT ||
      input.unreadOnly === true
    ) {
      return EMPTY_UNIBOX_THREADS;
    }

    const ownedChannelContext =
      await this.uniboxEmailChannelService.getOwnedEmailChannelContext({
        workspaceId,
        userWorkspaceId,
        connectedAccountIds: input.connectedAccountIds,
      });

    if (ownedChannelContext.channelIds.length === 0) {
      return EMPTY_UNIBOX_THREADS;
    }

    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageThreadRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageThreadWorkspaceEntity>(
            workspaceId,
            'messageThread',
            { shouldBypassPermissionChecks: true },
          );
        const messageParticipantRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
            workspaceId,
            'messageParticipant',
            { shouldBypassPermissionChecks: true },
          );

        let recordListType: RecordListWorkspaceEntity['type'] | undefined;
        let recordListPersonIds: string[] = [];

        if (input.recordListId) {
          const recordListRepository =
            await this.globalWorkspaceOrmManager.getRepository<RecordListWorkspaceEntity>(
              workspaceId,
              'recordList',
              { shouldBypassPermissionChecks: true },
            );
          const recordList = await recordListRepository.findOne({
            where: { id: input.recordListId },
            select: { id: true, type: true },
          });

          if (!recordList) {
            return EMPTY_UNIBOX_THREADS;
          }

          recordListType = recordList.type;

          if (recordListType !== RECORD_LIST_TYPES.PERSON) {
            const recordListMemberRepository =
              await this.globalWorkspaceOrmManager.getRepository<RecordListMemberWorkspaceEntity>(
                workspaceId,
                'recordListMember',
                { shouldBypassPermissionChecks: true },
              );
            const recordListMembers = await recordListMemberRepository.find({
              where: { recordListId: input.recordListId },
              select: { id: true },
            });
            const personIdsByListMember = await Promise.all(
              recordListMembers.map((recordListMember) =>
                this.relatedPersonIdsService.getRelatedPersonIds({
                  workspaceId,
                  objectNameSingular: 'recordListMember',
                  recordId: recordListMember.id,
                }),
              ),
            );

            recordListPersonIds = [...new Set(personIdsByListMember.flat())];

            if (recordListPersonIds.length === 0) {
              return EMPTY_UNIBOX_THREADS;
            }
          }
        }

        const { counterpartRoles, direction: folderDirection } =
          getUniboxEmailFolderQueryConfig(folder);
        const messageDateExpression =
          'COALESCE(message.receivedAt, message.createdAt)';
        const latestAssociationExpression = `(ARRAY_AGG(association.direction ORDER BY ${messageDateExpression} DESC, message.id DESC, association.id DESC))[1]`;

        let counterpartJoinCondition =
          'counterpartParticipant.role IN (:...counterpartRoles) AND counterpartParticipant.workspaceMemberId IS NULL';

        if (ownedChannelContext.ownedHandles.length > 0) {
          counterpartJoinCondition +=
            " AND LOWER(COALESCE(counterpartParticipant.handle, '')) NOT IN (:...ownedHandles)";
        }

        const baseQuery = messageThreadRepository
          .createQueryBuilder('messageThread')
          .innerJoin('messageThread.messages', 'message')
          .innerJoin('message.messageChannelMessageAssociations', 'association')
          .leftJoin('messageThread.messages', 'counterpartMessage')
          .innerJoin(
            'counterpartMessage.messageChannelMessageAssociations',
            'counterpartAssociation',
            'counterpartAssociation.messageChannelId IN (:...counterpartChannelIds)',
            { counterpartChannelIds: ownedChannelContext.channelIds },
          )
          .leftJoin(
            'counterpartMessage.messageParticipants',
            'counterpartParticipant',
            counterpartJoinCondition,
            {
              counterpartRoles,
              ownedHandles: ownedChannelContext.ownedHandles,
            },
          )
          .where('association.messageChannelId IN (:...channelIds)', {
            channelIds: ownedChannelContext.channelIds,
          })
          .groupBy('messageThread.id')
          .addGroupBy('messageThread.subject')
          .having(`${latestAssociationExpression} = :folderDirection`, {
            folderDirection,
          });

        if (input.onlyCrmContacts) {
          baseQuery.andWhere('counterpartParticipant.personId IS NOT NULL');
        }

        if (input.recordListId && recordListType === RECORD_LIST_TYPES.PERSON) {
          baseQuery
            .innerJoin('counterpartParticipant.person', 'recordListPerson')
            .innerJoin(
              'recordListPerson.recordListMemberships',
              'recordListMembership',
              'recordListMembership.recordListId = :recordListId',
              { recordListId: input.recordListId },
            );
        } else if (input.recordListId) {
          baseQuery.andWhere(
            'counterpartParticipant.personId IN (:...recordListPersonIds)',
            { recordListPersonIds },
          );
        }

        const normalizedSearch = input.search?.trim();

        if (normalizedSearch) {
          baseQuery.andWhere(
            '(messageThread.subject ILIKE :search OR counterpartParticipant.handle ILIKE :search OR counterpartParticipant.displayName ILIKE :search)',
            { search: `%${normalizedSearch}%` },
          );
        }

        if (input.dateFrom) {
          baseQuery.andHaving(`MAX(${messageDateExpression}) >= :dateFrom`, {
            dateFrom: input.dateFrom,
          });
        }

        const totalRows = await baseQuery
          .clone()
          .select('messageThread.id', 'id')
          .getRawMany<{ id: string }>();
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 30;

        const rows = await baseQuery
          .clone()
          .select('messageThread.id', 'id')
          .addSelect('messageThread.subject', 'subject')
          .addSelect(
            `LEFT(COALESCE((ARRAY_AGG(message.text ORDER BY ${messageDateExpression} DESC, message.id DESC, association.id DESC))[1], ''), :previewLength)`,
            'lastMessagePreview',
          )
          .addSelect(`MAX(${messageDateExpression})`, 'lastMessageAt')
          .addSelect('COUNT(DISTINCT message.id)::int', 'messageCount')
          .addSelect(
            `(ARRAY_AGG(association.messageChannelId ORDER BY ${messageDateExpression} DESC, message.id DESC, association.id DESC))[1]`,
            'lastMessageChannelId',
          )
          .setParameter('previewLength', UNIBOX_MESSAGE_PREVIEW_LENGTH)
          .orderBy(`MAX(${messageDateExpression})`, 'DESC')
          .addOrderBy('messageThread.id', 'ASC')
          .offset(getUniboxPageOffset(page, pageSize))
          .limit(pageSize)
          .getRawMany<UniboxThreadRawRow>();

        const participantsByThreadId = await this.getParticipantsByThreadId({
          messageParticipantRepository,
          threadIds: rows.map((row) => row.id),
          counterpartRoles,
          ownedHandles: ownedChannelContext.ownedHandles,
          ownedChannelIds: ownedChannelContext.channelIds,
        });

        return {
          totalCount: totalRows.length,
          threads: rows.map((row) => {
            const participants = participantsByThreadId.get(row.id) ?? [];

            return {
              id: row.id,
              channel: UniboxChannel.EMAIL,
              subject: row.subject ?? '',
              lastMessagePreview: row.lastMessagePreview?.trim() ?? '',
              lastMessageAt: new Date(row.lastMessageAt),
              messageCount: Number(row.messageCount),
              isRead: true,
              participants,
              hasCrmContact: participants.some(
                (participant) => participant.personId !== null,
              ),
              connectedAccountId:
                ownedChannelContext.connectedAccountIdByChannelId.get(
                  row.lastMessageChannelId,
                ) ?? null,
            };
          }),
        };
      },
      authContext,
    );
  }

  private async getParticipantsByThreadId({
    messageParticipantRepository,
    threadIds,
    counterpartRoles,
    ownedHandles,
    ownedChannelIds,
  }: {
    messageParticipantRepository: WorkspaceRepository<MessageParticipantWorkspaceEntity>;
    threadIds: string[];
    counterpartRoles: MessageParticipantRole[];
    ownedHandles: string[];
    ownedChannelIds: string[];
  }): Promise<Map<string, UniboxThreadParticipantDTO[]>> {
    if (threadIds.length === 0) {
      return new Map();
    }

    const query = messageParticipantRepository
      .createQueryBuilder('messageParticipant')
      .select('message.messageThreadId', 'threadId')
      .addSelect('LOWER(messageParticipant.handle)', 'handle')
      .addSelect('messageParticipant.displayName', 'displayName')
      .addSelect('messageParticipant.personId', 'personId')
      .addSelect('person.avatarUrl', 'avatarUrl')
      .innerJoin('messageParticipant.message', 'message')
      .innerJoin('message.messageChannelMessageAssociations', 'association')
      .leftJoin('messageParticipant.person', 'person')
      .where('message.messageThreadId IN (:...threadIds)', { threadIds })
      .andWhere('association.messageChannelId IN (:...ownedChannelIds)', {
        ownedChannelIds,
      })
      .andWhere('messageParticipant.role IN (:...counterpartRoles)', {
        counterpartRoles,
      })
      .andWhere('messageParticipant.workspaceMemberId IS NULL')
      .andWhere('messageParticipant.handle IS NOT NULL')
      .andWhere("BTRIM(messageParticipant.handle) <> ''");

    if (ownedHandles.length > 0) {
      query.andWhere(
        'LOWER(messageParticipant.handle) NOT IN (:...ownedHandles)',
        { ownedHandles },
      );
    }

    const rows = await query
      .distinctOn([
        'message.messageThreadId',
        'LOWER(messageParticipant.handle)',
      ])
      .orderBy('message.messageThreadId', 'ASC')
      .addOrderBy('LOWER(messageParticipant.handle)', 'ASC')
      .addOrderBy('COALESCE(message.receivedAt, message.createdAt)', 'DESC')
      .addOrderBy('messageParticipant.id', 'DESC')
      .getRawMany<UniboxThreadParticipantRawRow>();

    return rows.reduce((participantsByThreadId, row) => {
      const participant = {
        displayName: row.displayName?.trim() || row.handle,
        handle: row.handle,
        avatarUrl: row.avatarUrl,
        personId: row.personId,
      };
      const existingParticipants = participantsByThreadId.get(row.threadId);

      if (existingParticipants) {
        existingParticipants.push(participant);
      } else {
        participantsByThreadId.set(row.threadId, [participant]);
      }

      return participantsByThreadId;
    }, new Map<string, UniboxThreadParticipantDTO[]>());
  }
}
