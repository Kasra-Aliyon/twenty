import { type Repository } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MessageDraftAccessService } from 'src/modules/messaging/common/query-hooks/message-draft/message-draft-access.service';
import {
  MessageDraftCreateManyPreQueryHook,
  MessageDraftCreateOnePreQueryHook,
  MessageDraftDeleteManyPreQueryHook,
  MessageDraftDeleteOnePreQueryHook,
  MessageDraftDestroyManyPreQueryHook,
  MessageDraftDestroyOnePreQueryHook,
  MessageDraftFindDuplicatesPreQueryHook,
  MessageDraftFindManyPreQueryHook,
  MessageDraftFindOnePreQueryHook,
  MessageDraftGroupByPreQueryHook,
  MessageDraftMergeManyPreQueryHook,
  MessageDraftRestoreManyPreQueryHook,
  MessageDraftRestoreOnePreQueryHook,
  MessageDraftUpdateManyPreQueryHook,
  MessageDraftUpdateOnePreQueryHook,
} from 'src/modules/messaging/common/query-hooks/message-draft/message-draft.query-hooks';
import { type MessageDraftWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-draft.workspace-entity';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const USER_WORKSPACE_ID = '20202020-2222-4222-8222-222222222222';
const WORKSPACE_MEMBER_ID = '20202020-3333-4333-8333-333333333333';
const CONNECTED_ACCOUNT_ID = '20202020-4444-4444-8444-444444444444';
const DRAFT_ID = '20202020-5555-4555-8555-555555555555';
const MESSAGE_CHANNEL_ID = '20202020-7777-4777-8777-777777777777';
const MESSAGE_THREAD_ID = '20202020-8888-4888-8888-888888888888';
const SECOND_MESSAGE_THREAD_ID = '20202020-9999-4999-8999-999999999999';

describe('message draft query hooks', () => {
  const authContext = {
    type: 'user',
    workspace: { id: WORKSPACE_ID },
    userWorkspaceId: USER_WORKSPACE_ID,
    workspaceMemberId: WORKSPACE_MEMBER_ID,
    user: { id: '20202020-6666-4666-8666-666666666666' },
    workspaceMember: { id: WORKSPACE_MEMBER_ID },
  } as UserWorkspaceAuthContext;

  const draftRepository = {
    find: jest.fn(),
  };
  const messageThreadQueryBuilder = {
    andWhere: jest.fn(),
    distinct: jest.fn(),
    getRawMany: jest.fn(),
    innerJoin: jest.fn(),
    select: jest.fn(),
    where: jest.fn(),
  };

  for (const methodName of [
    'andWhere',
    'distinct',
    'innerJoin',
    'select',
    'where',
  ] as const) {
    messageThreadQueryBuilder[methodName].mockReturnValue(
      messageThreadQueryBuilder,
    );
  }

  const messageThreadRepository = {
    createQueryBuilder: jest.fn(() => messageThreadQueryBuilder),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
    getRepository: jest.fn(
      async (_workspaceId: string, objectNameSingular: string) =>
        objectNameSingular === 'messageThread'
          ? messageThreadRepository
          : draftRepository,
    ),
  };
  const connectedAccountRepository = {
    countBy: jest.fn(),
    find: jest.fn(),
  };
  const messageChannelRepository = {
    find: jest.fn(),
  };

  let accessService: MessageDraftAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    draftRepository.find.mockResolvedValue([{ id: DRAFT_ID }]);
    connectedAccountRepository.countBy.mockResolvedValue(1);
    connectedAccountRepository.find.mockResolvedValue([
      { id: CONNECTED_ACCOUNT_ID },
    ]);
    messageChannelRepository.find.mockResolvedValue([
      { id: MESSAGE_CHANNEL_ID },
    ]);
    messageThreadQueryBuilder.getRawMany.mockResolvedValue([
      { id: MESSAGE_THREAD_ID },
    ]);
    accessService = new MessageDraftAccessService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      connectedAccountRepository as unknown as Repository<ConnectedAccountEntity>,
      messageChannelRepository as unknown as Repository<MessageChannelEntity>,
    );
  });

  it('rejects non-user authentication contexts', () => {
    expect(() =>
      accessService.requireUserAuthContext({
        type: 'system',
        workspace: { id: WORKSPACE_ID },
      } as never),
    ).toThrow(
      expect.objectContaining({
        code: CommonQueryRunnerExceptionCode.INVALID_AUTH_CONTEXT,
      }),
    );
  });

  it('ANDs owner constraints into every filter-based read', async () => {
    const existingFilter = { subject: { ilike: 'hello' } };
    const findManyHook = new MessageDraftFindManyPreQueryHook(accessService);
    const findOneHook = new MessageDraftFindOnePreQueryHook(accessService);
    const groupByHook = new MessageDraftGroupByPreQueryHook(accessService);

    const findManyResult = await findManyHook.execute(
      authContext,
      'messageDraft',
      {
        filter: existingFilter,
      },
    );
    const findOneResult = await findOneHook.execute(
      authContext,
      'messageDraft',
      {
        filter: existingFilter,
      },
    );
    const groupByResult = await groupByHook.execute(
      authContext,
      'messageDraft',
      {
        filter: existingFilter,
        groupBy: [{ subject: true }],
      },
    );

    for (const result of [findManyResult, findOneResult, groupByResult]) {
      expect(result.filter).toEqual({
        and: [existingFilter, { authorId: { eq: WORKSPACE_MEMBER_ID } }],
      });
    }
  });

  it('forces the author and validates connected-account ownership on creates', async () => {
    const createOneHook = new MessageDraftCreateOnePreQueryHook(accessService);
    const createManyHook = new MessageDraftCreateManyPreQueryHook(
      accessService,
    );
    const draftData = {
      connectedAccountId: CONNECTED_ACCOUNT_ID,
      authorId: '20202020-7777-4777-8777-777777777777',
      subject: 'Draft',
      body: null as unknown as string,
      cc: null as unknown as string,
      bcc: null as unknown as string,
    } satisfies Partial<MessageDraftWorkspaceEntity>;

    const createOneResult = await createOneHook.execute(
      authContext,
      'messageDraft',
      { data: draftData },
    );
    const createManyResult = await createManyHook.execute(
      authContext,
      'messageDraft',
      { data: [draftData] },
    );

    expect(createOneResult.data.authorId).toBe(WORKSPACE_MEMBER_ID);
    expect(createOneResult.data).toEqual(
      expect.objectContaining({ body: '', cc: '', bcc: '' }),
    );
    expect(createOneResult.data.lastEditedAt).toBeInstanceOf(Date);
    expect(createManyResult.data[0].authorId).toBe(WORKSPACE_MEMBER_ID);
    expect(connectedAccountRepository.countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        userWorkspaceId: USER_WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
      }),
    );
  });

  it('rejects a connected account outside the authenticated user', async () => {
    connectedAccountRepository.countBy.mockResolvedValue(0);
    const hook = new MessageDraftCreateOnePreQueryHook(accessService);

    await expect(
      hook.execute(authContext, 'messageDraft', {
        data: { connectedAccountId: CONNECTED_ACCOUNT_ID },
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it('rejects missing createMany connected-account ids before querying accounts', async () => {
    const hook = new MessageDraftCreateManyPreQueryHook(accessService);

    await expect(
      hook.execute(authContext, 'messageDraft', {
        data: [
          { connectedAccountId: CONNECTED_ACCOUNT_ID },
          { subject: 'Missing sender account' },
        ],
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
    expect(connectedAccountRepository.countBy).not.toHaveBeenCalled();
  });

  it('validates supplied thread ids on create and update operations', async () => {
    const assertMessageThreadsOwnedByUser = jest
      .spyOn(accessService, 'assertMessageThreadsOwnedByUser')
      .mockResolvedValue();

    await new MessageDraftCreateOnePreQueryHook(accessService).execute(
      authContext,
      'messageDraft',
      {
        data: {
          connectedAccountId: CONNECTED_ACCOUNT_ID,
          messageThreadId: MESSAGE_THREAD_ID,
        },
      },
    );
    await new MessageDraftCreateManyPreQueryHook(accessService).execute(
      authContext,
      'messageDraft',
      {
        data: [
          {
            connectedAccountId: CONNECTED_ACCOUNT_ID,
            messageThreadId: MESSAGE_THREAD_ID,
          },
          {
            connectedAccountId: CONNECTED_ACCOUNT_ID,
            messageThreadId: SECOND_MESSAGE_THREAD_ID,
          },
        ],
      },
    );
    await new MessageDraftUpdateOnePreQueryHook(accessService).execute(
      authContext,
      'messageDraft',
      {
        id: DRAFT_ID,
        data: { messageThreadId: MESSAGE_THREAD_ID },
      },
    );
    await new MessageDraftUpdateManyPreQueryHook(accessService).execute(
      authContext,
      'messageDraft',
      {
        filter: { id: { eq: DRAFT_ID } },
        data: { messageThreadId: SECOND_MESSAGE_THREAD_ID },
      },
    );

    expect(assertMessageThreadsOwnedByUser).toHaveBeenNthCalledWith(1, {
      messageThreadIds: [MESSAGE_THREAD_ID],
      authContext,
    });
    expect(assertMessageThreadsOwnedByUser).toHaveBeenNthCalledWith(2, {
      messageThreadIds: [MESSAGE_THREAD_ID, SECOND_MESSAGE_THREAD_ID],
      authContext,
    });
    expect(assertMessageThreadsOwnedByUser).toHaveBeenNthCalledWith(3, {
      messageThreadIds: [MESSAGE_THREAD_ID],
      authContext,
    });
    expect(assertMessageThreadsOwnedByUser).toHaveBeenNthCalledWith(4, {
      messageThreadIds: [SECOND_MESSAGE_THREAD_ID],
      authContext,
    });
  });

  it('rejects a message thread outside the authenticated user channels', async () => {
    messageThreadQueryBuilder.getRawMany.mockResolvedValue([]);

    await expect(
      accessService.assertMessageThreadsOwnedByUser({
        messageThreadIds: [MESSAGE_THREAD_ID],
        authContext,
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
    });
    expect(connectedAccountRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userWorkspaceId: USER_WORKSPACE_ID,
          workspaceId: WORKSPACE_ID,
        }),
      }),
    );
    expect(messageThreadQueryBuilder.andWhere).toHaveBeenCalledWith(
      'association.messageChannelId IN (:...channelIds)',
      { channelIds: [MESSAGE_CHANNEL_ID] },
    );
  });

  it('validates one-record ownership and prevents author transfer on update', async () => {
    const hook = new MessageDraftUpdateOnePreQueryHook(accessService);
    const result = await hook.execute(authContext, 'messageDraft', {
      id: DRAFT_ID,
      data: {
        connectedAccountId: CONNECTED_ACCOUNT_ID,
        authorId: '20202020-7777-4777-8777-777777777777',
      },
    });

    expect(result.data.authorId).toBe(WORKSPACE_MEMBER_ID);
    expect(draftRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: expect.anything(),
          authorId: WORKSPACE_MEMBER_ID,
        },
        withDeleted: true,
      }),
    );
  });

  it('validates ownership for every id-only destructive operation', async () => {
    const hooks = [
      new MessageDraftDeleteOnePreQueryHook(accessService),
      new MessageDraftDestroyOnePreQueryHook(accessService),
      new MessageDraftRestoreOnePreQueryHook(accessService),
    ];

    for (const hook of hooks) {
      await expect(
        hook.execute(authContext, 'messageDraft', { id: DRAFT_ID }),
      ).resolves.toEqual({ id: DRAFT_ID });
    }

    expect(draftRepository.find).toHaveBeenCalledTimes(hooks.length);
  });

  it('rejects id-only operations when any draft is not owned', async () => {
    draftRepository.find.mockResolvedValue([]);
    const hook = new MessageDraftDestroyOnePreQueryHook(accessService);

    await expect(
      hook.execute(authContext, 'messageDraft', { id: DRAFT_ID }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
    });
  });

  it('ANDs owner constraints into every many-record mutation', async () => {
    const existingFilter = { subject: { ilike: 'hello' } };
    const hooks = [
      new MessageDraftDeleteManyPreQueryHook(accessService),
      new MessageDraftDestroyManyPreQueryHook(accessService),
      new MessageDraftRestoreManyPreQueryHook(accessService),
    ];

    for (const hook of hooks) {
      const result = await hook.execute(authContext, 'messageDraft', {
        filter: existingFilter,
      });

      expect(result.filter).toEqual({
        and: [existingFilter, { authorId: { eq: WORKSPACE_MEMBER_ID } }],
      });
    }
  });

  it('secures updateMany with an owner filter and immutable author', async () => {
    const hook = new MessageDraftUpdateManyPreQueryHook(accessService);
    const result = await hook.execute(authContext, 'messageDraft', {
      filter: { subject: { ilike: 'hello' } },
      data: { subject: 'Updated' },
    });

    expect(result.filter).toEqual({
      and: [
        { subject: { ilike: 'hello' } },
        { authorId: { eq: WORKSPACE_MEMBER_ID } },
      ],
    });
    expect(result.data.authorId).toBe(WORKSPACE_MEMBER_ID);
  });

  it('rejects generic operations that cannot carry a safe owner predicate', async () => {
    const findDuplicatesHook = new MessageDraftFindDuplicatesPreQueryHook(
      accessService,
    );
    const mergeManyHook = new MessageDraftMergeManyPreQueryHook(accessService);
    const createOneHook = new MessageDraftCreateOnePreQueryHook(accessService);

    for (const operation of [
      findDuplicatesHook.execute(authContext, 'messageDraft', {
        ids: [DRAFT_ID],
      }),
      mergeManyHook.execute(authContext, 'messageDraft', {
        ids: [DRAFT_ID],
        conflictPriorityIndex: 0,
      }),
      createOneHook.execute(authContext, 'messageDraft', {
        data: { connectedAccountId: CONNECTED_ACCOUNT_ID },
        upsert: true,
      }),
    ]) {
      await expect(operation).rejects.toBeInstanceOf(
        CommonQueryRunnerException,
      );
    }
  });
});
