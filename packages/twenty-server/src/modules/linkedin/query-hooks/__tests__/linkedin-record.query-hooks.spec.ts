import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  LINKEDIN_OWNED_OBJECT_NAMES,
  LinkedinRecordAccessService,
} from 'src/modules/linkedin/query-hooks/linkedin-record-access.service';
import {
  LinkedinRecordCreateManyPreQueryHook,
  LinkedinRecordCreateOnePreQueryHook,
  LinkedinRecordDeleteManyPreQueryHook,
  LinkedinRecordDestroyManyPreQueryHook,
  LinkedinRecordFindDuplicatesPreQueryHook,
  LinkedinRecordFindManyPreQueryHook,
  LinkedinRecordFindOnePreQueryHook,
  LinkedinRecordGroupByPreQueryHook,
  LinkedinRecordMergeManyPreQueryHook,
  LinkedinRecordRestoreManyPreQueryHook,
  LinkedinRecordUpdateManyPreQueryHook,
  LinkedinRecordUpdateOnePreQueryHook,
} from 'src/modules/linkedin/query-hooks/linkedin-record.query-hooks';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const WORKSPACE_MEMBER_ID = '20202020-2222-4222-8222-222222222222';
const OTHER_WORKSPACE_MEMBER_ID = '20202020-3333-4333-8333-333333333333';
const RECORD_ID = '20202020-4444-4444-8444-444444444444';
const THREAD_ID = '20202020-5555-4555-8555-555555555555';

const buildLinkedinStandardObjectMetadataMaps = () => ({
  byUniversalIdentifier: Object.fromEntries(
    LINKEDIN_OWNED_OBJECT_NAMES.map((objectName) => {
      const universalIdentifier =
        STANDARD_OBJECTS[objectName].universalIdentifier;

      return [
        universalIdentifier,
        {
          universalIdentifier,
          nameSingular: objectName,
          isActive: true,
        },
      ];
    }),
  ),
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
});

describe('LinkedIn record query hooks', () => {
  const authContext = {
    type: 'user',
    workspace: { id: WORKSPACE_ID },
    userWorkspaceId: '20202020-6666-4666-8666-666666666666',
    workspaceMemberId: WORKSPACE_MEMBER_ID,
    user: { id: '20202020-7777-4777-8777-777777777777' },
    workspaceMember: { id: WORKSPACE_MEMBER_ID },
  } as UserWorkspaceAuthContext;
  const repository = {
    find: jest.fn(),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
    getRepository: jest.fn(async () => repository),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn(),
  };

  let accessService: LinkedinRecordAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.find.mockResolvedValue([
      {
        id: RECORD_ID,
        ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
      },
    ]);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      flatObjectMetadataMaps: buildLinkedinStandardObjectMetadataMaps(),
    });
    accessService = new LinkedinRecordAccessService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      workspaceCacheService as unknown as WorkspaceCacheService,
    );
  });

  it('rejects non-user authentication contexts for LinkedIn records', () => {
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

  it('ANDs caller ownership into every filter-based LinkedIn read', async () => {
    const existingFilter = { name: { ilike: 'hello' } };
    const findManyHook = new LinkedinRecordFindManyPreQueryHook(accessService);
    const findOneHook = new LinkedinRecordFindOnePreQueryHook(accessService);
    const groupByHook = new LinkedinRecordGroupByPreQueryHook(accessService);

    for (const objectName of LINKEDIN_OWNED_OBJECT_NAMES) {
      const findManyResult = await findManyHook.execute(
        authContext,
        objectName,
        {
          filter: existingFilter,
        },
      );
      const findOneResult = await findOneHook.execute(authContext, objectName, {
        filter: existingFilter,
      });
      const groupByResult = await groupByHook.execute(authContext, objectName, {
        filter: existingFilter,
        groupBy: [{ name: true }],
      });

      for (const result of [findManyResult, findOneResult, groupByResult]) {
        expect(result.filter).toEqual({
          and: [
            existingFilter,
            {
              ownerWorkspaceMemberId: { eq: WORKSPACE_MEMBER_ID },
            },
          ],
        });
      }
    }
  });

  it('does not change queries for objects outside the LinkedIn connector', async () => {
    const payload = { filter: { status: { eq: 'PENDING' } } };

    await expect(
      new LinkedinRecordFindManyPreQueryHook(accessService).execute(
        authContext,
        'person',
        payload,
      ),
    ).resolves.toBe(payload);
  });

  it('does not treat a legacy custom same-name object as an owned LinkedIn object', async () => {
    workspaceCacheService.getOrRecompute.mockResolvedValueOnce({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {
          '20202020-8888-4888-8888-888888888888': {
            universalIdentifier: '20202020-8888-4888-8888-888888888888',
            nameSingular: 'linkedinConnection',
            isActive: true,
          },
        },
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
    });
    const payload = { filter: { name: { ilike: 'legacy' } } };

    await expect(
      new LinkedinRecordFindManyPreQueryHook(accessService).execute(
        authContext,
        'linkedinConnection',
        payload,
      ),
    ).resolves.toBe(payload);
  });

  it('requires the standard LinkedIn object metadata to be active and name-matched', async () => {
    const universalIdentifier =
      STANDARD_OBJECTS.linkedinMessage.universalIdentifier;
    const payload = { filter: { body: { ilike: 'hello' } } };

    for (const objectMetadata of [
      {
        universalIdentifier,
        nameSingular: 'linkedinMessage',
        isActive: false,
      },
      {
        universalIdentifier,
        nameSingular: 'legacyLinkedinMessage',
        isActive: true,
      },
    ]) {
      workspaceCacheService.getOrRecompute.mockResolvedValueOnce({
        flatObjectMetadataMaps: {
          byUniversalIdentifier: { [universalIdentifier]: objectMetadata },
          universalIdentifierById: {},
          universalIdentifiersByApplicationId: {},
        },
      });

      await expect(
        new LinkedinRecordFindManyPreQueryHook(accessService).execute(
          authContext,
          'linkedinMessage',
          payload,
        ),
      ).resolves.toBe(payload);
    }
  });

  it('forces caller ownership on create and keeps extension upsert enabled', async () => {
    const assertThreadIdsOwnedByUser = jest
      .spyOn(accessService, 'assertThreadIdsOwnedByUser')
      .mockResolvedValue();
    const assertUpsertRecordIdsDoNotBelongToAnotherUser = jest
      .spyOn(accessService, 'assertUpsertRecordIdsDoNotBelongToAnotherUser')
      .mockResolvedValue();
    const hook = new LinkedinRecordCreateManyPreQueryHook(accessService);
    const payload = {
      upsert: true,
      data: [
        {
          id: RECORD_ID,
          externalId: 'linkedin-owner:message-id',
          ownerWorkspaceMemberId: OTHER_WORKSPACE_MEMBER_ID,
          threadId: THREAD_ID,
        },
      ],
    };

    const result = await hook.execute(authContext, 'linkedinMessage', payload);

    expect(result.upsert).toBe(true);
    expect(result.data[0].ownerWorkspaceMemberId).toBe(WORKSPACE_MEMBER_ID);
    expect(assertThreadIdsOwnedByUser).toHaveBeenCalledWith({
      threadIds: [THREAD_ID],
      authContext,
    });
    expect(assertUpsertRecordIdsDoNotBelongToAnotherUser).toHaveBeenCalledWith({
      objectName: 'linkedinMessage',
      recordIds: [RECORD_ID],
      authContext,
    });
  });

  it('validates thread ownership on child create and relation updates', async () => {
    const assertThreadIdsOwnedByUser = jest
      .spyOn(accessService, 'assertThreadIdsOwnedByUser')
      .mockResolvedValue();
    jest.spyOn(accessService, 'assertRecordIdsOwnedByUser').mockResolvedValue();

    await new LinkedinRecordCreateOnePreQueryHook(accessService).execute(
      authContext,
      'linkedinThreadParticipant',
      { data: { threadId: THREAD_ID } },
    );
    await new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
      authContext,
      'linkedinMessage',
      { id: RECORD_ID, data: { threadId: THREAD_ID } },
    );

    expect(assertThreadIdsOwnedByUser).toHaveBeenNthCalledWith(1, {
      threadIds: [THREAD_ID],
      authContext,
    });
    expect(assertThreadIdsOwnedByUser).toHaveBeenNthCalledWith(2, {
      threadIds: [THREAD_ID],
      authContext,
    });
  });

  it('rejects an upsert that explicitly targets another member record id', async () => {
    repository.find.mockResolvedValue([
      {
        id: RECORD_ID,
        ownerWorkspaceMemberId: OTHER_WORKSPACE_MEMBER_ID,
      },
    ]);

    await expect(
      new LinkedinRecordCreateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinConnection',
        {
          upsert: true,
          data: { id: RECORD_ID, externalId: 'external-id' },
        },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
    });
  });

  it('rejects an id mutation when the record is not caller-owned', async () => {
    repository.find.mockResolvedValue([]);

    await expect(
      new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinInvitation',
        { id: RECORD_ID, data: { name: 'Updated' } },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
    });
  });

  it('rejects a child relation to another member thread', async () => {
    repository.find.mockResolvedValue([]);

    await expect(
      new LinkedinRecordCreateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinMessage',
        { data: { threadId: THREAD_ID } },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
    });
    expect(globalWorkspaceOrmManager.getRepository).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'linkedinMessageThread',
      { shouldBypassPermissionChecks: true },
    );
  });

  it('secures every many-record mutation and prevents ownership transfer', async () => {
    const existingFilter = { externalId: { eq: 'external-id' } };
    const updateResult = await new LinkedinRecordUpdateManyPreQueryHook(
      accessService,
    ).execute(authContext, 'linkedinConnection', {
      filter: existingFilter,
      data: { ownerWorkspaceMemberId: OTHER_WORKSPACE_MEMBER_ID },
    });
    const filterOnlyHooks = [
      new LinkedinRecordDeleteManyPreQueryHook(accessService),
      new LinkedinRecordDestroyManyPreQueryHook(accessService),
      new LinkedinRecordRestoreManyPreQueryHook(accessService),
    ];

    expect(updateResult.data.ownerWorkspaceMemberId).toBe(WORKSPACE_MEMBER_ID);

    for (const result of [
      updateResult,
      ...(await Promise.all(
        filterOnlyHooks.map((hook) =>
          hook.execute(authContext, 'linkedinConnection', {
            filter: existingFilter,
          }),
        ),
      )),
    ]) {
      expect(result.filter).toEqual({
        and: [
          existingFilter,
          { ownerWorkspaceMemberId: { eq: WORKSPACE_MEMBER_ID } },
        ],
      });
    }
  });

  it('rejects operations that cannot safely carry an owner predicate', async () => {
    const operations = [
      new LinkedinRecordFindDuplicatesPreQueryHook(accessService).execute(
        authContext,
        'linkedinMessage',
        { ids: [RECORD_ID] },
      ),
      new LinkedinRecordMergeManyPreQueryHook(accessService).execute(
        authContext,
        'linkedinConnection',
        { ids: [RECORD_ID], conflictPriorityIndex: 0 },
      ),
    ];

    for (const operation of operations) {
      await expect(operation).rejects.toBeInstanceOf(
        CommonQueryRunnerException,
      );
    }
  });
});
