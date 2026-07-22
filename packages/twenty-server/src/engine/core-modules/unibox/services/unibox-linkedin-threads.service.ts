import { Injectable } from '@nestjs/common';

import { RECORD_LIST_TYPES } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type UniboxThreadParticipantDTO } from 'src/engine/core-modules/unibox/dtos/unibox-thread-participant.dto';
import { type UniboxThreadsWithTotalDTO } from 'src/engine/core-modules/unibox/dtos/unibox-threads-with-total.dto';
import { type UniboxThreadsInput } from 'src/engine/core-modules/unibox/dtos/unibox-threads.input';
import { UniboxChannel } from 'src/engine/core-modules/unibox/enums/unibox-channel.enum';
import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';
import { getUniboxPageOffset } from 'src/engine/core-modules/unibox/utils/unibox-query.utils';
import { RelatedPersonIdsService } from 'src/engine/core-modules/related-person-ids/services/related-person-ids.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type LinkedinMessageThreadWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message-thread.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';

type GetUniboxLinkedinThreadsArgs = {
  input: UniboxThreadsInput;
  workspaceId: string;
  workspaceMemberId: string;
};

type LinkedinThreadRawRow = {
  id: string;
  subject: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | string;
  messageCount: string | number | null;
  totalCount: string | number;
};

type LinkedinParticipantRawRow = {
  threadId: string;
  name: string | null;
  handle: string | null;
  linkedinUrn: string | null;
  avatarUrl: string | null;
  personId: string | null;
};

const EMPTY_LINKEDIN_THREADS: UniboxThreadsWithTotalDTO = {
  totalCount: 0,
  threads: [],
};

@Injectable()
export class UniboxLinkedinThreadsService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly relatedPersonIdsService: RelatedPersonIdsService,
  ) {}

  async getThreads({
    input,
    workspaceId,
    workspaceMemberId,
  }: GetUniboxLinkedinThreadsArgs): Promise<UniboxThreadsWithTotalDTO> {
    if (
      input.channel !== UniboxChannel.LINKEDIN ||
      input.folder === UniboxFolder.DRAFT ||
      input.unreadOnly === true
    ) {
      return EMPTY_LINKEDIN_THREADS;
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const linkedinMessageThreadRepository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinMessageThreadWorkspaceEntity>(
            workspaceId,
            'linkedinMessageThread',
            { shouldBypassPermissionChecks: true },
          );
        const linkedinThreadParticipantRepository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinThreadParticipantWorkspaceEntity>(
            workspaceId,
            'linkedinThreadParticipant',
            { shouldBypassPermissionChecks: true },
          );

        const recordListPersonIds = await this.resolveRecordListPersonIds({
          input,
          workspaceId,
        });

        if (recordListPersonIds?.length === 0) {
          return EMPTY_LINKEDIN_THREADS;
        }

        const baseQuery = linkedinMessageThreadRepository
          .createQueryBuilder('linkedinMessageThread')
          .where(
            'linkedinMessageThread.ownerWorkspaceMemberId = :workspaceMemberId',
            { workspaceMemberId },
          );
        const lastMessageAtExpression =
          'COALESCE(linkedinMessageThread.lastMessageTime, linkedinMessageThread.firstMessageTime, linkedinMessageThread.createdAt)';

        if (input.onlyCrmContacts || recordListPersonIds) {
          const participantFilterConditions = [
            '"linkedinThreadParticipantFilter"."threadId" = "linkedinMessageThread"."id"',
            '"linkedinThreadParticipantFilter"."ownerWorkspaceMemberId" = :workspaceMemberId',
            '"linkedinThreadParticipantFilter"."isSelf" = false',
            '"linkedinThreadParticipantFilter"."deletedAt" IS NULL',
          ];

          if (input.onlyCrmContacts) {
            participantFilterConditions.push(
              '"linkedinThreadParticipantFilter"."personId" IS NOT NULL',
            );
          }

          if (recordListPersonIds) {
            participantFilterConditions.push(
              '"linkedinThreadParticipantFilter"."personId" IN (:...recordListPersonIds)',
            );
          }

          baseQuery.andWhere(
            `EXISTS (
              SELECT 1
              FROM "linkedinThreadParticipant" "linkedinThreadParticipantFilter"
              WHERE ${participantFilterConditions.join(' AND ')}
            )`,
            {
              workspaceMemberId,
              ...(recordListPersonIds ? { recordListPersonIds } : {}),
            },
          );
        }

        const normalizedSearch = input.search?.trim();

        if (normalizedSearch) {
          baseQuery.andWhere(
            `(
              "linkedinMessageThread"."name" ILIKE :search
              OR EXISTS (
                SELECT 1
                FROM "linkedinThreadParticipant" "linkedinThreadParticipantSearch"
                WHERE "linkedinThreadParticipantSearch"."threadId" = "linkedinMessageThread"."id"
                  AND "linkedinThreadParticipantSearch"."ownerWorkspaceMemberId" = :workspaceMemberId
                  AND "linkedinThreadParticipantSearch"."isSelf" = false
                  AND "linkedinThreadParticipantSearch"."deletedAt" IS NULL
                  AND (
                    "linkedinThreadParticipantSearch"."name" ILIKE :search
                    OR "linkedinThreadParticipantSearch"."handle" ILIKE :search
                  )
              )
            )`,
            { search: `%${normalizedSearch}%`, workspaceMemberId },
          );
        }

        if (input.dateFrom) {
          baseQuery.andWhere(`${lastMessageAtExpression} >= :dateFrom`, {
            dateFrom: input.dateFrom,
          });
        }

        const hasCursor =
          isDefined(input.afterLastMessageAt) && isDefined(input.afterThreadId);

        if (hasCursor) {
          baseQuery.andWhere(
            `(
              ${lastMessageAtExpression} < :afterLastMessageAt
              OR (
                ${lastMessageAtExpression} = :afterLastMessageAt
                AND linkedinMessageThread.id > :afterThreadId
              )
            )`,
            {
              afterLastMessageAt: input.afterLastMessageAt,
              afterThreadId: input.afterThreadId,
            },
          );
        }

        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 30;
        const pageQuery = baseQuery
          .clone()
          .select('linkedinMessageThread.id', 'id')
          .addSelect('linkedinMessageThread.name', 'subject')
          .addSelect(
            "COALESCE(linkedinMessageThread.lastMessagePreview, '')",
            'lastMessagePreview',
          )
          .addSelect(lastMessageAtExpression, 'lastMessageAt')
          .addSelect('linkedinMessageThread.messageCount', 'messageCount')
          .addSelect('COUNT(*) OVER()', 'totalCount')
          .distinct(true)
          .orderBy(lastMessageAtExpression, 'DESC')
          .addOrderBy('linkedinMessageThread.id', 'ASC')
          .limit(pageSize);

        if (!hasCursor) {
          pageQuery.offset(getUniboxPageOffset(page, pageSize));
        }

        const rows = await pageQuery.getRawMany<LinkedinThreadRawRow>();
        const participantsByThreadId = await this.getParticipantsByThreadId({
          linkedinThreadParticipantRepository,
          threadIds: rows.map(({ id }) => id),
          workspaceMemberId,
        });

        return {
          totalCount: Number(rows[0]?.totalCount ?? 0),
          threads: rows.map((row) => {
            const participants = participantsByThreadId.get(row.id) ?? [];

            return {
              id: row.id,
              channel: UniboxChannel.LINKEDIN,
              subject: row.subject?.trim() || 'LinkedIn conversation',
              lastMessagePreview: row.lastMessagePreview?.trim() ?? '',
              lastMessageAt: new Date(row.lastMessageAt),
              messageCount: Number(row.messageCount ?? 0),
              isRead: true,
              participants,
              hasCrmContact: participants.some(
                ({ personId }) => personId !== null,
              ),
              connectedAccountId: null,
            };
          }),
        };
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async resolveRecordListPersonIds({
    input,
    workspaceId,
  }: {
    input: UniboxThreadsInput;
    workspaceId: string;
  }): Promise<string[] | undefined> {
    if (!input.recordListId) {
      return undefined;
    }

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
      return [];
    }

    const recordListMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository<RecordListMemberWorkspaceEntity>(
        workspaceId,
        'recordListMember',
        { shouldBypassPermissionChecks: true },
      );

    if (recordList.type === RECORD_LIST_TYPES.PERSON) {
      const members = await recordListMemberRepository.find({
        where: { recordListId: recordList.id },
        select: { targetPersonId: true },
      });

      return [
        ...new Set(
          members
            .map(({ targetPersonId }) => targetPersonId)
            .filter((personId): personId is string => personId !== null),
        ),
      ];
    }

    const members = await recordListMemberRepository.find({
      where: { recordListId: recordList.id },
      select: { id: true },
    });
    const personIdsByMember = await Promise.all(
      members.map(({ id }) =>
        this.relatedPersonIdsService.getRelatedPersonIds({
          workspaceId,
          objectNameSingular: 'recordListMember',
          recordId: id,
        }),
      ),
    );

    return [...new Set(personIdsByMember.flat())];
  }

  private async getParticipantsByThreadId({
    linkedinThreadParticipantRepository,
    threadIds,
    workspaceMemberId,
  }: {
    linkedinThreadParticipantRepository: WorkspaceRepository<LinkedinThreadParticipantWorkspaceEntity>;
    threadIds: string[];
    workspaceMemberId: string;
  }): Promise<Map<string, UniboxThreadParticipantDTO[]>> {
    if (threadIds.length === 0) {
      return new Map();
    }

    const rows = await linkedinThreadParticipantRepository
      .createQueryBuilder('linkedinThreadParticipant')
      .select('linkedinThreadParticipant.threadId', 'threadId')
      .addSelect('linkedinThreadParticipant.name', 'name')
      .addSelect('linkedinThreadParticipant.handle', 'handle')
      .addSelect('linkedinThreadParticipant.linkedinUrn', 'linkedinUrn')
      .addSelect('linkedinThreadParticipant.personId', 'personId')
      .addSelect('person.avatarUrl', 'avatarUrl')
      .leftJoin('linkedinThreadParticipant.person', 'person')
      .where('linkedinThreadParticipant.threadId IN (:...threadIds)', {
        threadIds,
      })
      .andWhere(
        'linkedinThreadParticipant.ownerWorkspaceMemberId = :workspaceMemberId',
        { workspaceMemberId },
      )
      .andWhere('linkedinThreadParticipant.isSelf = false')
      .orderBy('linkedinThreadParticipant.threadId', 'ASC')
      .addOrderBy('linkedinThreadParticipant.name', 'ASC')
      .getRawMany<LinkedinParticipantRawRow>();

    return rows.reduce((participantsByThreadId, row) => {
      const participant = {
        displayName:
          row.name?.trim() ||
          row.handle?.trim() ||
          row.linkedinUrn ||
          'LinkedIn member',
        handle: row.handle?.trim() || row.linkedinUrn || '',
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
