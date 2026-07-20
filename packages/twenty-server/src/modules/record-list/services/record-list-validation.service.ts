import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { In } from 'typeorm';
import { RECORD_LIST_TYPES, type RecordListType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';

const MAX_RECORD_LIST_NAME_LENGTH = 255;

const TARGET_FIELD_BY_RECORD_LIST_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: 'targetCompanyId',
  [RECORD_LIST_TYPES.PERSON]: 'targetPersonId',
  [RECORD_LIST_TYPES.OPPORTUNITY]: 'targetOpportunityId',
} as const satisfies Record<
  RecordListType,
  keyof Pick<
    RecordListMemberWorkspaceEntity,
    'targetCompanyId' | 'targetPersonId' | 'targetOpportunityId'
  >
>;

type RecordListMemberInput = Partial<RecordListMemberWorkspaceEntity>;

@Injectable()
export class RecordListValidationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  public normalizeAndValidateName(data: { name?: string | null }): void {
    if (!isDefined(data.name)) {
      return;
    }

    const name = data.name.trim().replace(/\s+/g, ' ');

    if (name.length === 0 || name.length > MAX_RECORD_LIST_NAME_LENGTH) {
      throw new CommonQueryRunnerException(
        'Record list names must contain between 1 and 255 characters',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`List names must contain between 1 and 255 characters.`,
        },
      );
    }

    data.name = name;
  }

  public validateListTypeIsImmutable(
    data: Partial<RecordListWorkspaceEntity>,
  ): void {
    if (isDefined(data.type)) {
      throw new CommonQueryRunnerException(
        'Record list type cannot be changed',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        { userFriendlyMessage: msg`A list's record type cannot be changed.` },
      );
    }
  }

  public validateMemberIsImmutable(data: RecordListMemberInput): void {
    if (
      isDefined(data.recordListId) ||
      isDefined(data.targetCompanyId) ||
      isDefined(data.targetPersonId) ||
      isDefined(data.targetOpportunityId)
    ) {
      throw new CommonQueryRunnerException(
        'Record list membership targets cannot be changed',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`Remove this membership and add a new one instead.`,
        },
      );
    }
  }

  public async validateMembersForCreate({
    data,
    workspaceId,
  }: {
    data: RecordListMemberInput[];
    workspaceId: string;
  }): Promise<void> {
    const listIds = [...new Set(data.map(({ recordListId }) => recordListId))];

    if (listIds.some((listId) => !isDefined(listId))) {
      this.throwInvalidMember();
    }

    const authContext = buildSystemAuthContext(workspaceId);
    const lists =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<RecordListWorkspaceEntity>(
              workspaceId,
              'recordList',
              { shouldBypassPermissionChecks: true },
            );

          return repository.findBy({ id: In(listIds.filter(isDefined)) });
        },
        authContext,
      );
    const listById = new Map(lists.map((list) => [list.id, list]));

    for (const member of data) {
      const targetFields = [
        'targetCompanyId',
        'targetPersonId',
        'targetOpportunityId',
      ] as const;
      const populatedTargetFields = targetFields.filter((fieldName) =>
        isDefined(member[fieldName]),
      );
      const list = isDefined(member.recordListId)
        ? listById.get(member.recordListId)
        : undefined;

      if (
        populatedTargetFields.length !== 1 ||
        !isDefined(list) ||
        populatedTargetFields[0] !== TARGET_FIELD_BY_RECORD_LIST_TYPE[list.type]
      ) {
        this.throwInvalidMember();
      }
    }
  }

  public async validateFolderIsEmpty({
    folderId,
    workspaceId,
  }: {
    folderId: string;
    workspaceId: string;
  }): Promise<void> {
    await this.validateFoldersAreEmpty({
      folderIds: [folderId],
      workspaceId,
    });
  }

  public async validateFoldersAreEmpty({
    folderIds,
    workspaceId,
  }: {
    folderIds: string[];
    workspaceId: string;
  }): Promise<void> {
    const authContext = buildSystemAuthContext(workspaceId);
    const listCount =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<RecordListWorkspaceEntity>(
              workspaceId,
              'recordList',
              { shouldBypassPermissionChecks: true },
            );

          return repository.countBy({ folderId: In(folderIds) });
        },
        authContext,
      );

    if (listCount > 0) {
      throw new CommonQueryRunnerException(
        'Record list folder must be empty before deletion',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`Move or delete every list in this folder first.`,
        },
      );
    }
  }

  private throwInvalidMember(): never {
    throw new CommonQueryRunnerException(
      'A record list member must target exactly one record matching the list type',
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`This record does not match the list's record type.`,
      },
    );
  }
}
