import { RECORD_LIST_TYPES } from 'twenty-shared/types';

import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';
import { UniboxEmailChannelService } from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import { UniboxEmailThreadsService } from 'src/engine/core-modules/unibox/services/unibox-email-threads.service';
import { RelatedPersonIdsService } from 'src/engine/core-modules/related-person-ids/services/related-person-ids.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';

type MockQueryBuilder = {
  addGroupBy: jest.Mock;
  addOrderBy: jest.Mock;
  addSelect: jest.Mock;
  andHaving: jest.Mock;
  andWhere: jest.Mock;
  clone: jest.Mock;
  distinctOn: jest.Mock;
  getRawMany: jest.Mock;
  groupBy: jest.Mock;
  having: jest.Mock;
  innerJoin: jest.Mock;
  leftJoin: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  orderBy: jest.Mock;
  select: jest.Mock;
  setParameter: jest.Mock;
  where: jest.Mock;
};

const createMockQueryBuilder = (rawRows: object[] = []): MockQueryBuilder => {
  const queryBuilder = {} as MockQueryBuilder;
  const fluentMethods: (keyof Omit<
    MockQueryBuilder,
    'clone' | 'getRawMany'
  >)[] = [
    'addGroupBy',
    'addOrderBy',
    'addSelect',
    'andHaving',
    'andWhere',
    'distinctOn',
    'groupBy',
    'having',
    'innerJoin',
    'leftJoin',
    'limit',
    'offset',
    'orderBy',
    'select',
    'setParameter',
    'where',
  ];

  for (const method of fluentMethods) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.clone = jest.fn();
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rawRows);

  return queryBuilder;
};

describe('UniboxEmailThreadsService', () => {
  const workspaceId = 'workspace-id';
  const userWorkspaceId = 'user-workspace-id';
  let baseQuery: MockQueryBuilder;
  let pageQuery: MockQueryBuilder;
  let participantQuery: MockQueryBuilder;
  let recordListRepository: { findOne: jest.Mock };
  let recordListMemberRepository: { find: jest.Mock };
  let relatedPersonIdsService: { getRelatedPersonIds: jest.Mock };
  let emailChannelServiceMock: {
    getOwnedEmailChannelContext: jest.Mock;
    getUnreadFolderIds: jest.Mock;
  };
  let service: UniboxEmailThreadsService;

  beforeEach(() => {
    baseQuery = createMockQueryBuilder();
    pageQuery = createMockQueryBuilder([]);
    participantQuery = createMockQueryBuilder([]);
    baseQuery.clone.mockReturnValueOnce(pageQuery);

    recordListRepository = {
      findOne: jest.fn(),
    };
    recordListMemberRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    relatedPersonIdsService = {
      getRelatedPersonIds: jest.fn(),
    };

    const messageThreadRepository = {
      createQueryBuilder: jest.fn(() => baseQuery),
    };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn((callback: () => Promise<unknown>) =>
        callback(),
      ),
      getRepository: jest.fn(
        (_workspaceId: string, objectNameSingular: string) => {
          if (objectNameSingular === 'messageThread') {
            return Promise.resolve(messageThreadRepository);
          }

          if (objectNameSingular === 'recordList') {
            return Promise.resolve(recordListRepository);
          }

          if (objectNameSingular === 'recordListMember') {
            return Promise.resolve(recordListMemberRepository);
          }

          if (objectNameSingular === 'messageParticipant') {
            return Promise.resolve({
              createQueryBuilder: jest.fn(() => participantQuery),
            });
          }

          return Promise.resolve({});
        },
      ),
    };
    const emailChannelService = {
      getOwnedEmailChannelContext: jest.fn().mockResolvedValue({
        accounts: [],
        channels: [],
        channelIds: ['channel-id'],
        ownedHandles: ['owner@example.com'],
        connectedAccountIdByChannelId: new Map(),
      }),
      getUnreadFolderIds: jest.fn().mockResolvedValue(['unread-folder-id']),
    };

    emailChannelServiceMock = emailChannelService;

    service = new UniboxEmailThreadsService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      emailChannelService as unknown as UniboxEmailChannelService,
      relatedPersonIdsService as unknown as RelatedPersonIdsService,
    );
  });

  it('should keep aggregate joins separate from CRM/search filters', async () => {
    const dateFrom = new Date('2026-07-01T00:00:00.000Z');

    await service.getThreads({
      input: {
        folder: UniboxFolder.SENT,
        onlyCrmContacts: true,
        search: ' Ada ',
        dateFrom,
        page: 2,
        pageSize: 30,
      },
      workspaceId,
      userWorkspaceId,
    });

    expect(baseQuery.innerJoin).toHaveBeenCalledWith(
      'messageThread.messages',
      'message',
    );
    expect(baseQuery.leftJoin).toHaveBeenCalledWith(
      'messageThread.messages',
      'counterpartMessage',
    );
    expect(baseQuery.innerJoin).toHaveBeenCalledWith(
      'counterpartMessage.messageChannelMessageAssociations',
      'counterpartAssociation',
      'counterpartAssociation.messageChannelId IN (:...counterpartChannelIds)',
      { counterpartChannelIds: ['channel-id'] },
    );
    expect(baseQuery.leftJoin).toHaveBeenCalledWith(
      'counterpartMessage.messageParticipants',
      'counterpartParticipant',
      expect.any(String),
      expect.any(Object),
    );
    expect(baseQuery.having).toHaveBeenCalledWith(
      'BOOL_OR(association.direction = :folderDirection)',
      { folderDirection: MessageDirection.OUTGOING },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      'counterpartParticipant.personId IS NOT NULL',
    );
    expect(baseQuery.andHaving).toHaveBeenCalledWith(
      'MAX(COALESCE(message.receivedAt, message.createdAt)) >= :dateFrom',
      { dateFrom },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('messageThread.subject ILIKE :search'),
      { search: '%Ada%' },
    );
    expect(pageQuery.offset).toHaveBeenCalledWith(30);
    expect(pageQuery.limit).toHaveBeenCalledWith(30);
  });

  it('should hydrate participants only from caller-owned channels', async () => {
    pageQuery.getRawMany.mockResolvedValue([
      {
        id: 'thread-id',
        subject: 'Subject',
        lastMessagePreview: 'Preview',
        lastMessageAt: new Date('2026-07-22T00:00:00.000Z'),
        messageCount: 1,
        lastMessageChannelId: 'channel-id',
      },
    ]);

    await service.getThreads({
      input: {},
      workspaceId,
      userWorkspaceId,
    });

    expect(participantQuery.innerJoin).toHaveBeenCalledWith(
      'message.messageChannelMessageAssociations',
      'association',
    );
    expect(participantQuery.andWhere).toHaveBeenCalledWith(
      'association.messageChannelId IN (:...ownedChannelIds)',
      { ownedChannelIds: ['channel-id'] },
    );
  });

  it('should use a stable cursor instead of an offset after the first page', async () => {
    const afterLastMessageAt = new Date('2026-07-21T00:00:00.000Z');

    await service.getThreads({
      input: {
        afterLastMessageAt,
        afterThreadId: '11111111-1111-4111-8111-111111111111',
        page: 99,
        pageSize: 30,
      },
      workspaceId,
      userWorkspaceId,
    });

    expect(baseQuery.andHaving).toHaveBeenCalledWith(
      expect.stringContaining('messageThread.id > :afterThreadId'),
      {
        afterLastMessageAt,
        afterThreadId: '11111111-1111-4111-8111-111111111111',
      },
    );
    expect(pageQuery.offset).not.toHaveBeenCalled();
    expect(pageQuery.limit).toHaveBeenCalledWith(30);
  });

  it('should derive isRead from unread folder membership', async () => {
    pageQuery.getRawMany.mockResolvedValue([
      {
        id: 'unread-thread-id',
        subject: 'Unread',
        lastMessagePreview: 'Preview',
        lastMessageAt: new Date('2026-07-22T00:00:00.000Z'),
        messageCount: 1,
        lastMessageChannelId: 'channel-id',
        isUnread: true,
      },
      {
        id: 'read-thread-id',
        subject: 'Read',
        lastMessagePreview: 'Preview',
        lastMessageAt: new Date('2026-07-22T00:00:00.000Z'),
        messageCount: 1,
        lastMessageChannelId: 'channel-id',
        isUnread: false,
      },
    ]);

    const result = await service.getThreads({
      input: {},
      workspaceId,
      userWorkspaceId,
    });

    expect(baseQuery.leftJoin).toHaveBeenCalledWith(
      'association.messageFolders',
      'associationFolder',
    );
    expect(baseQuery.setParameter).toHaveBeenCalledWith('unreadFolderIds', [
      'unread-folder-id',
    ]);
    expect(result.threads.map((thread) => thread.isRead)).toEqual([
      false,
      true,
    ]);
  });

  it('should filter on unread folder membership when unreadOnly is set', async () => {
    await service.getThreads({
      input: { unreadOnly: true },
      workspaceId,
      userWorkspaceId,
    });

    expect(baseQuery.andHaving).toHaveBeenCalledWith(
      'COALESCE(BOOL_OR(associationFolder.messageFolderId IN (:...unreadFolderIds)), false)',
    );
  });

  it('should treat threads as read when the provider syncs no unread folder', async () => {
    emailChannelServiceMock.getUnreadFolderIds.mockResolvedValue([]);
    pageQuery.getRawMany.mockResolvedValue([
      {
        id: 'thread-id',
        subject: 'Subject',
        lastMessagePreview: 'Preview',
        lastMessageAt: new Date('2026-07-22T00:00:00.000Z'),
        messageCount: 1,
        lastMessageChannelId: 'channel-id',
        isUnread: null,
      },
    ]);

    const result = await service.getThreads({
      input: {},
      workspaceId,
      userWorkspaceId,
    });

    expect(baseQuery.leftJoin).not.toHaveBeenCalledWith(
      'association.messageFolders',
      'associationFolder',
    );
    expect(result.threads[0].isRead).toBe(true);
  });

  it('should return no threads when unreadOnly is set without an unread folder', async () => {
    emailChannelServiceMock.getUnreadFolderIds.mockResolvedValue([]);

    const result = await service.getThreads({
      input: { unreadOnly: true },
      workspaceId,
      userWorkspaceId,
    });

    expect(result).toEqual({ totalCount: 0, threads: [] });
    expect(baseQuery.andHaving).not.toHaveBeenCalled();
  });

  it('should keep person-list filtering on the direct membership join', async () => {
    recordListRepository.findOne.mockResolvedValue({
      id: 'list-id',
      type: RECORD_LIST_TYPES.PERSON,
    });

    await service.getThreads({
      input: { recordListId: 'list-id' },
      workspaceId,
      userWorkspaceId,
    });

    expect(baseQuery.innerJoin).toHaveBeenCalledWith(
      'counterpartParticipant.person',
      'recordListPerson',
    );
    expect(baseQuery.innerJoin).toHaveBeenCalledWith(
      'recordListPerson.recordListMemberships',
      'recordListMembership',
      'recordListMembership.recordListId = :recordListId',
      { recordListId: 'list-id' },
    );
    expect(relatedPersonIdsService.getRelatedPersonIds).not.toHaveBeenCalled();
  });

  it.each([RECORD_LIST_TYPES.COMPANY, RECORD_LIST_TYPES.OPPORTUNITY])(
    'should resolve and deduplicate people for a %s list',
    async (recordListType) => {
      recordListRepository.findOne.mockResolvedValue({
        id: 'list-id',
        type: recordListType,
      });
      recordListMemberRepository.find.mockResolvedValue([
        { id: 'member-1' },
        { id: 'member-2' },
      ]);
      relatedPersonIdsService.getRelatedPersonIds
        .mockResolvedValueOnce(['person-1', 'person-2'])
        .mockResolvedValueOnce(['person-2', 'person-3']);

      await service.getThreads({
        input: { recordListId: 'list-id' },
        workspaceId,
        userWorkspaceId,
      });

      expect(relatedPersonIdsService.getRelatedPersonIds).toHaveBeenCalledTimes(
        2,
      );
      expect(
        relatedPersonIdsService.getRelatedPersonIds,
      ).toHaveBeenNthCalledWith(1, {
        workspaceId,
        objectNameSingular: 'recordListMember',
        recordId: 'member-1',
      });
      expect(baseQuery.andWhere).toHaveBeenCalledWith(
        'counterpartParticipant.personId IN (:...recordListPersonIds)',
        { recordListPersonIds: ['person-1', 'person-2', 'person-3'] },
      );
    },
  );

  it('should return no threads when a non-person list resolves no people', async () => {
    recordListRepository.findOne.mockResolvedValue({
      id: 'list-id',
      type: RECORD_LIST_TYPES.COMPANY,
    });
    recordListMemberRepository.find.mockResolvedValue([{ id: 'member-1' }]);
    relatedPersonIdsService.getRelatedPersonIds.mockResolvedValue([]);

    const result = await service.getThreads({
      input: { recordListId: 'list-id' },
      workspaceId,
      userWorkspaceId,
    });

    expect(result).toEqual({ totalCount: 0, threads: [] });
    expect(baseQuery.innerJoin).not.toHaveBeenCalled();
  });
});
