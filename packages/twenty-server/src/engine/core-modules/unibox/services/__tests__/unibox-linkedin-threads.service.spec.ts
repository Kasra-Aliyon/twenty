import { RECORD_LIST_TYPES } from 'twenty-shared/types';

import { UniboxChannel } from 'src/engine/core-modules/unibox/enums/unibox-channel.enum';
import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';
import { UniboxLinkedinThreadsService } from 'src/engine/core-modules/unibox/services/unibox-linkedin-threads.service';
import { RelatedPersonIdsService } from 'src/engine/core-modules/related-person-ids/services/related-person-ids.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

type MockQueryBuilder = {
  addOrderBy: jest.Mock;
  addSelect: jest.Mock;
  andWhere: jest.Mock;
  clone: jest.Mock;
  distinct: jest.Mock;
  escape: jest.Mock;
  getRawMany: jest.Mock;
  leftJoin: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  orderBy: jest.Mock;
  select: jest.Mock;
  where: jest.Mock;
};

const createMockQueryBuilder = (rawRows: object[] = []): MockQueryBuilder => {
  const queryBuilder = {} as MockQueryBuilder;
  const fluentMethods: (keyof Omit<
    MockQueryBuilder,
    'clone' | 'getRawMany'
  >)[] = [
    'addOrderBy',
    'addSelect',
    'andWhere',
    'distinct',
    'leftJoin',
    'limit',
    'offset',
    'orderBy',
    'select',
    'where',
  ];

  for (const method of fluentMethods) {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  }

  queryBuilder.clone = jest.fn();
  queryBuilder.escape = jest.fn((identifier: string) => `"${identifier}"`);
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rawRows);

  return queryBuilder;
};

describe('UniboxLinkedinThreadsService', () => {
  const workspaceId = 'workspace-id';
  const workspaceMemberId = 'workspace-member-id';
  let baseQuery: MockQueryBuilder;
  let pageQuery: MockQueryBuilder;
  let participantQuery: MockQueryBuilder;
  let linkedinMessageThreadRepository: { createQueryBuilder: jest.Mock };
  let recordListRepository: { findOne: jest.Mock };
  let recordListMemberRepository: { find: jest.Mock };
  let relatedPersonIdsService: { getRelatedPersonIds: jest.Mock };
  let globalWorkspaceOrmManager: {
    executeInWorkspaceContext: jest.Mock;
    getRepository: jest.Mock;
  };
  let service: UniboxLinkedinThreadsService;

  beforeEach(() => {
    baseQuery = createMockQueryBuilder();
    pageQuery = createMockQueryBuilder([
      {
        id: 'thread-id',
        subject: ' Ada Lovelace ',
        lastMessagePreview: ' Hello ',
        lastMessageAt: '2026-07-22T10:00:00.000Z',
        messageCount: '2',
        totalCount: '1',
      },
    ]);
    participantQuery = createMockQueryBuilder([
      {
        threadId: 'thread-id',
        name: ' Ada Lovelace ',
        handle: ' ada ',
        linkedinUrn: 'urn:li:fsd_profile:ada',
        avatarUrl: null,
        personId: 'person-id',
      },
    ]);
    baseQuery.clone.mockReturnValueOnce(pageQuery);

    linkedinMessageThreadRepository = {
      createQueryBuilder: jest.fn(() => baseQuery),
    };
    const linkedinThreadParticipantRepository = {
      createQueryBuilder: jest.fn(() => participantQuery),
      metadata: {
        tablePath: 'workspace_test.linkedinThreadParticipant',
      },
    };
    recordListRepository = {
      findOne: jest.fn(),
    };
    recordListMemberRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    relatedPersonIdsService = {
      getRelatedPersonIds: jest.fn(),
    };
    globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn((callback: () => Promise<unknown>) =>
        callback(),
      ),
      getRepository: jest.fn(
        (_workspaceId: string, objectNameSingular: string) => {
          if (objectNameSingular === 'linkedinMessageThread') {
            return Promise.resolve(linkedinMessageThreadRepository);
          }

          if (objectNameSingular === 'linkedinThreadParticipant') {
            return Promise.resolve(linkedinThreadParticipantRepository);
          }

          if (objectNameSingular === 'recordList') {
            return Promise.resolve(recordListRepository);
          }

          if (objectNameSingular === 'recordListMember') {
            return Promise.resolve(recordListMemberRepository);
          }

          return Promise.resolve({});
        },
      ),
    };

    service = new UniboxLinkedinThreadsService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      relatedPersonIdsService as unknown as RelatedPersonIdsService,
    );
  });

  it('should constrain all thread queries to the authenticated workspace member', async () => {
    const dateFrom = new Date('2026-07-01T00:00:00.000Z');

    const result = await service.getThreads({
      input: {
        channel: UniboxChannel.LINKEDIN,
        onlyCrmContacts: true,
        search: ' Ada ',
        dateFrom,
        page: 2,
        pageSize: 15,
      },
      workspaceId,
      workspaceMemberId,
    });

    expect(baseQuery.where).toHaveBeenCalledWith(
      'linkedinMessageThread.ownerWorkspaceMemberId = :workspaceMemberId',
      { workspaceMemberId },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        '"linkedinThreadParticipantFilter"."personId" IS NOT NULL',
      ),
      { workspaceMemberId },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        'FROM "workspace_test"."linkedinThreadParticipant" "linkedinThreadParticipantFilter"',
      ),
      { workspaceMemberId },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        '"linkedinThreadParticipantSearch"."ownerWorkspaceMemberId" = :workspaceMemberId',
      ),
      { search: '%Ada%', workspaceMemberId },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        'FROM "workspace_test"."linkedinThreadParticipant" "linkedinThreadParticipantSearch"',
      ),
      { search: '%Ada%', workspaceMemberId },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      'COALESCE(linkedinMessageThread.lastMessageTime, linkedinMessageThread.firstMessageTime, linkedinMessageThread.createdAt) >= :dateFrom',
      { dateFrom },
    );
    expect(pageQuery.offset).toHaveBeenCalledWith(15);
    expect(pageQuery.limit).toHaveBeenCalledWith(15);
    expect(participantQuery.andWhere).toHaveBeenCalledWith(
      'linkedinThreadParticipant.ownerWorkspaceMemberId = :workspaceMemberId',
      { workspaceMemberId },
    );
    expect(participantQuery.andWhere).toHaveBeenCalledWith(
      'linkedinThreadParticipant.isSelf = false',
    );
    expect(result).toEqual({
      totalCount: 1,
      threads: [
        expect.objectContaining({
          id: 'thread-id',
          channel: UniboxChannel.LINKEDIN,
          subject: 'Ada Lovelace',
          messageCount: 2,
          hasCrmContact: true,
          connectedAccountId: null,
        }),
      ],
    });
  });

  it('should use a stable cursor instead of an offset after the first page', async () => {
    const afterLastMessageAt = new Date('2026-07-21T00:00:00.000Z');

    await service.getThreads({
      input: {
        channel: UniboxChannel.LINKEDIN,
        afterLastMessageAt,
        afterThreadId: '11111111-1111-4111-8111-111111111111',
        page: 99,
        pageSize: 30,
      },
      workspaceId,
      workspaceMemberId,
    });

    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('linkedinMessageThread.id > :afterThreadId'),
      {
        afterLastMessageAt,
        afterThreadId: '11111111-1111-4111-8111-111111111111',
      },
    );
    expect(pageQuery.offset).not.toHaveBeenCalled();
    expect(pageQuery.limit).toHaveBeenCalledWith(30);
  });

  it('should deduplicate person-list members before filtering threads', async () => {
    recordListRepository.findOne.mockResolvedValue({
      id: 'list-id',
      type: RECORD_LIST_TYPES.PERSON,
    });
    recordListMemberRepository.find.mockResolvedValue([
      { targetPersonId: 'person-1' },
      { targetPersonId: 'person-1' },
      { targetPersonId: 'person-2' },
      { targetPersonId: null },
    ]);

    await service.getThreads({
      input: {
        channel: UniboxChannel.LINKEDIN,
        recordListId: 'list-id',
      },
      workspaceId,
      workspaceMemberId,
    });

    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        '"linkedinThreadParticipantFilter"."personId" IN (:...recordListPersonIds)',
      ),
      {
        workspaceMemberId,
        recordListPersonIds: ['person-1', 'person-2'],
      },
    );
    expect(relatedPersonIdsService.getRelatedPersonIds).not.toHaveBeenCalled();
  });

  it('should stop before querying threads when a record list has no people', async () => {
    recordListRepository.findOne.mockResolvedValue({
      id: 'list-id',
      type: RECORD_LIST_TYPES.COMPANY,
    });
    recordListMemberRepository.find.mockResolvedValue([{ id: 'member-id' }]);
    relatedPersonIdsService.getRelatedPersonIds.mockResolvedValue([]);

    const result = await service.getThreads({
      input: {
        channel: UniboxChannel.LINKEDIN,
        recordListId: 'list-id',
      },
      workspaceId,
      workspaceMemberId,
    });

    expect(result).toEqual({ totalCount: 0, threads: [] });
    expect(
      linkedinMessageThreadRepository.createQueryBuilder,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['another channel', { channel: UniboxChannel.EMAIL }],
    ['drafts', { channel: UniboxChannel.LINKEDIN, folder: UniboxFolder.DRAFT }],
    ['unread only', { channel: UniboxChannel.LINKEDIN, unreadOnly: true }],
  ])(
    'should return no threads for unsupported %s requests',
    async (_, input) => {
      const result = await service.getThreads({
        input,
        workspaceId,
        workspaceMemberId,
      });

      expect(result).toEqual({ totalCount: 0, threads: [] });
      expect(
        globalWorkspaceOrmManager.executeInWorkspaceContext,
      ).not.toHaveBeenCalled();
    },
  );
});
