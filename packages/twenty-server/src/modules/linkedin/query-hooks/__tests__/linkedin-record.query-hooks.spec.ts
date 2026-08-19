import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { LINKEDIN_ACTION_STATUSES } from 'twenty-shared/types';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { shouldRunWorkspaceQueryInTransaction } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
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
  LinkedinRecordDeleteOnePreQueryHook,
  LinkedinRecordDestroyManyPreQueryHook,
  LinkedinRecordDestroyOnePreQueryHook,
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
const LINKEDIN_ACTION_BASE_UPDATE_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy',
  'searchVector',
] as const;
const CAP_COUNTED_LINKEDIN_ACTION_STATUSES = [
  LINKEDIN_ACTION_STATUSES.SCHEDULED,
  LINKEDIN_ACTION_STATUSES.CLAIMED,
  LINKEDIN_ACTION_STATUSES.COMPLETED,
  LINKEDIN_ACTION_STATUSES.SKIPPED,
  LINKEDIN_ACTION_STATUSES.FAILED,
] as const;

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
  const transactionalRepository = {
    find: jest.fn(),
  };
  const workspaceEntityManager = {
    getRepository: jest.fn(() => transactionalRepository),
  } as unknown as WorkspaceEntityManager;
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
    repository.find.mockReset();
    transactionalRepository.find.mockReset();
    transactionalRepository.find.mockResolvedValue([]);
    repository.find.mockImplementation(async (options) =>
      Array.isArray(options.where) || options.where?.status
        ? []
        : [
            {
              id: RECORD_ID,
              ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
            },
          ],
    );
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

  it('rejects generic one- and many-record LinkedIn action claims', async () => {
    const updateOne = new LinkedinRecordUpdateOnePreQueryHook(accessService);
    const updateMany = new LinkedinRecordUpdateManyPreQueryHook(accessService);

    await expect(
      updateOne.execute(authContext, 'linkedinAction', {
        id: RECORD_ID,
        data: { status: LINKEDIN_ACTION_STATUSES.CLAIMED },
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
    await expect(
      updateMany.execute(authContext, 'linkedinAction', {
        filter: { id: { eq: RECORD_ID } },
        data: { status: LINKEDIN_ACTION_STATUSES.CLAIMED },
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it('rejects client-created sequence action relations while preserving direct actions', async () => {
    const createOne = new LinkedinRecordCreateOnePreQueryHook(accessService);
    const createMany = new LinkedinRecordCreateManyPreQueryHook(accessService);

    await expect(
      createOne.execute(authContext, 'linkedinAction', {
        data: {
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          sequenceEnrollmentId: 'enrollment-id',
        },
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
    await expect(
      createMany.execute(authContext, 'linkedinAction', {
        data: [
          {
            status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
            sequenceStepId: 'step-id',
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });

    await expect(
      createOne.execute(authContext, 'linkedinAction', {
        data: {
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          sequenceEnrollmentId: null,
          sequenceStepId: null,
        },
      }),
    ).resolves.toEqual({
      data: {
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        sequenceEnrollmentId: null,
        sequenceStepId: null,
        ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
      },
    });
  });

  it('rejects upsert targeting an existing sequence-linked action', async () => {
    repository.find
      .mockResolvedValueOnce([
        {
          id: RECORD_ID,
          ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
        },
      ])
      .mockResolvedValueOnce([{ id: RECORD_ID }]);

    await expect(
      new LinkedinRecordCreateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          upsert: true,
          data: {
            id: RECORD_ID,
            status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it('rejects upsert targeting existing unlinked quota history', async () => {
    repository.find
      .mockResolvedValueOnce([
        {
          id: RECORD_ID,
          ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
        },
      ])
      .mockResolvedValueOnce([
        { id: RECORD_ID, status: LINKEDIN_ACTION_STATUSES.COMPLETED },
      ]);

    await expect(
      new LinkedinRecordCreateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          upsert: true,
          data: {
            id: RECORD_ID,
            status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it.each([
    {
      operationName: 'createOne upsert',
      buildHook: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordCreateOnePreQueryHook(service),
      buildPayload: () => ({
        upsert: true,
        data: {
          id: RECORD_ID,
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        },
      }),
    },
    {
      operationName: 'createMany upsert',
      buildHook: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordCreateManyPreQueryHook(service),
      buildPayload: () => ({
        upsert: true,
        data: [
          {
            id: RECORD_ID,
            status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          },
        ],
      }),
    },
  ])(
    'rejects $operationName so a missing-row conflict cannot overwrite execution history',
    async ({ buildHook, buildPayload }) => {
      const hook = buildHook(accessService);

      await expect(
        hook.execute(authContext, 'linkedinAction', buildPayload() as never),
      ).rejects.toMatchObject({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      });
    },
  );

  it('rejects forged sequence action completion and unlinking through updateOne', async () => {
    repository.find
      .mockResolvedValueOnce([
        {
          id: RECORD_ID,
          ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
        },
      ])
      .mockResolvedValueOnce([{ id: RECORD_ID }]);

    await expect(
      new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          id: RECORD_ID,
          data: { status: LINKEDIN_ACTION_STATUSES.COMPLETED },
        },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });

    await expect(
      new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          id: RECORD_ID,
          data: { sequenceEnrollmentId: null },
        },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it('rejects changing unlinked quota history to cancelled before deletion', async () => {
    repository.find
      .mockResolvedValueOnce([
        {
          id: RECORD_ID,
          ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
        },
      ])
      .mockResolvedValueOnce([
        { id: RECORD_ID, status: LINKEDIN_ACTION_STATUSES.COMPLETED },
      ]);

    await expect(
      new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          id: RECORD_ID,
          data: { status: LINKEDIN_ACTION_STATUSES.CANCELLED },
        },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it('rechecks updateOne under a row lock after a safe pre-read', async () => {
    const hook = new LinkedinRecordUpdateOnePreQueryHook(accessService);
    const payload = await hook.execute(authContext, 'linkedinAction', {
      id: RECORD_ID,
      data: { status: LINKEDIN_ACTION_STATUSES.COMPLETED },
    });

    expect(shouldRunWorkspaceQueryInTransaction(payload)).toBe(true);

    transactionalRepository.find.mockResolvedValue([
      {
        id: RECORD_ID,
        ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
        sequenceEnrollmentId: null,
        sequenceStepId: null,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
    ]);

    await expect(
      hook.executeInTransaction(
        authContext,
        'linkedinAction',
        payload,
        workspaceEntityManager,
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });
  });

  it.each(LINKEDIN_ACTION_BASE_UPDATE_FIELDS)(
    'rejects sequence-linked action updates through the %s base field',
    async (fieldName) => {
      repository.find
        .mockResolvedValueOnce([
          {
            id: RECORD_ID,
            ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
          },
        ])
        .mockResolvedValueOnce([{ id: RECORD_ID }]);

      await expect(
        new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
          authContext,
          'linkedinAction',
          {
            id: RECORD_ID,
            data: { [fieldName]: 'replacement-value' },
          },
        ),
      ).rejects.toMatchObject({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      });
    },
  );

  it('atomically excludes sequence-linked actions from generic engine updates', async () => {
    const originalFilter = { id: { eq: RECORD_ID } };

    const result = await new LinkedinRecordUpdateManyPreQueryHook(
      accessService,
    ).execute(authContext, 'linkedinAction', {
      filter: originalFilter,
      data: { status: LINKEDIN_ACTION_STATUSES.COMPLETED },
    });

    expect(result.filter).toEqual({
      and: [
        {
          and: [
            originalFilter,
            { ownerWorkspaceMemberId: { eq: WORKSPACE_MEMBER_ID } },
          ],
        },
        {
          not: {
            or: [
              { sequenceEnrollmentId: { is: 'NOT_NULL' } },
              { sequenceStepId: { is: 'NOT_NULL' } },
              { status: { in: CAP_COUNTED_LINKEDIN_ACTION_STATUSES } },
            ],
          },
        },
      ],
    });
  });

  it.each(LINKEDIN_ACTION_BASE_UPDATE_FIELDS)(
    'atomically excludes sequence-linked actions from updateMany through the %s base field',
    async (fieldName) => {
      const originalFilter = { id: { eq: RECORD_ID } };

      const result = await new LinkedinRecordUpdateManyPreQueryHook(
        accessService,
      ).execute(authContext, 'linkedinAction', {
        filter: originalFilter,
        data: { [fieldName]: 'replacement-value' },
      });

      expect(result.filter).toEqual({
        and: [
          {
            and: [
              originalFilter,
              { ownerWorkspaceMemberId: { eq: WORKSPACE_MEMBER_ID } },
            ],
          },
          {
            not: {
              or: [
                { sequenceEnrollmentId: { is: 'NOT_NULL' } },
                { sequenceStepId: { is: 'NOT_NULL' } },
                { status: { in: CAP_COUNTED_LINKEDIN_ACTION_STATUSES } },
              ],
            },
          },
        ],
      });
    },
  );

  it('keeps generic engine updates available for unlinked cancelled actions', async () => {
    await expect(
      new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          id: RECORD_ID,
          data: { status: LINKEDIN_ACTION_STATUSES.COMPLETED },
        },
      ),
    ).resolves.toMatchObject({
      id: RECORD_ID,
      data: {
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
      },
    });
  });

  it('preserves generic custom-field edits on sequence-linked actions', async () => {
    await expect(
      new LinkedinRecordUpdateOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        {
          id: RECORD_ID,
          data: { customReviewNote: 'Reviewed' },
        },
      ),
    ).resolves.toEqual({
      id: RECORD_ID,
      data: {
        customReviewNote: 'Reviewed',
        ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
      },
    });

    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      operationName: 'soft-delete',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDeleteOnePreQueryHook(service),
    },
    {
      operationName: 'permanently destroy',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDestroyOnePreQueryHook(service),
    },
  ])(
    'blocks $operationName of sequence action history in every status',
    async ({ buildOperation }) => {
      repository.find
        .mockResolvedValueOnce([
          {
            id: RECORD_ID,
            ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
          },
        ])
        .mockResolvedValueOnce([{ id: RECORD_ID }]);

      await expect(
        buildOperation(accessService).execute(authContext, 'linkedinAction', {
          id: RECORD_ID,
        }),
      ).rejects.toMatchObject({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      });

      expect(repository.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          select: ['id'],
          where: expect.arrayContaining([
            expect.objectContaining({
              id: expect.anything(),
              ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
              sequenceEnrollmentId: expect.anything(),
            }),
          ]),
          withDeleted: true,
        }),
      );
    },
  );

  it.each([
    {
      operationName: 'soft-delete',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDeleteOnePreQueryHook(service),
    },
    {
      operationName: 'permanently destroy',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDestroyOnePreQueryHook(service),
    },
  ])(
    'blocks $operationName of every unlinked action that contributes to the owner cap',
    async ({ buildOperation }) => {
      for (const status of CAP_COUNTED_LINKEDIN_ACTION_STATUSES) {
        repository.find
          .mockResolvedValueOnce([
            {
              id: RECORD_ID,
              ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
            },
          ])
          .mockResolvedValueOnce([{ id: RECORD_ID, status }]);

        await expect(
          buildOperation(accessService).execute(authContext, 'linkedinAction', {
            id: RECORD_ID,
          }),
        ).rejects.toMatchObject({
          code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
        });
      }
    },
  );

  it('blocks permanent deletion of completed quota history without excluding cancelled markers', async () => {
    repository.find
      .mockResolvedValueOnce([
        {
          id: RECORD_ID,
          ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
        },
      ])
      .mockResolvedValueOnce([
        { id: RECORD_ID, status: LINKEDIN_ACTION_STATUSES.COMPLETED },
      ]);

    await expect(
      new LinkedinRecordDestroyOnePreQueryHook(accessService).execute(
        authContext,
        'linkedinAction',
        { id: RECORD_ID },
      ),
    ).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
    });

    const protectionQuery = repository.find.mock.calls[1][0];

    expect(protectionQuery.withDeleted).toBe(true);
    expect(protectionQuery.where).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sequenceEnrollmentId: expect.anything(),
        }),
        expect.objectContaining({
          sequenceStepId: expect.anything(),
        }),
        expect.objectContaining({
          status: expect.anything(),
        }),
      ]),
    );
    expect(protectionQuery.where[0]).not.toHaveProperty('status');
    expect(protectionQuery.where[1]).not.toHaveProperty('status');
  });

  it('preserves one-record deletion for unlinked cancelled actions', async () => {
    const deleteOne = new LinkedinRecordDeleteOnePreQueryHook(accessService);
    const destroyOne = new LinkedinRecordDestroyOnePreQueryHook(accessService);

    await expect(
      deleteOne.execute(authContext, 'linkedinAction', { id: RECORD_ID }),
    ).resolves.toMatchObject({ id: RECORD_ID });
    await expect(
      destroyOne.execute(authContext, 'linkedinAction', { id: RECORD_ID }),
    ).resolves.toMatchObject({ id: RECORD_ID });

    expect(repository.find).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      operationName: 'soft-delete',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDeleteOnePreQueryHook(service),
    },
    {
      operationName: 'permanently destroy',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDestroyOnePreQueryHook(service),
    },
  ])(
    'rechecks $operationName under a row lock after a safe pre-read',
    async ({ buildOperation }) => {
      const hook = buildOperation(accessService);
      const payload = await hook.execute(authContext, 'linkedinAction', {
        id: RECORD_ID,
      });

      expect(shouldRunWorkspaceQueryInTransaction(payload)).toBe(true);

      transactionalRepository.find.mockResolvedValue([
        {
          id: RECORD_ID,
          ownerWorkspaceMemberId: WORKSPACE_MEMBER_ID,
          sequenceEnrollmentId: null,
          sequenceStepId: null,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        },
      ]);

      await expect(
        hook.executeInTransaction(
          authContext,
          'linkedinAction',
          payload,
          workspaceEntityManager,
        ),
      ).rejects.toMatchObject({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      });
    },
  );

  it.each([
    {
      operationName: 'soft-delete',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDeleteManyPreQueryHook(service),
    },
    {
      operationName: 'permanently destroy',
      buildOperation: (service: LinkedinRecordAccessService) =>
        new LinkedinRecordDestroyManyPreQueryHook(service),
    },
  ])(
    'atomically excludes sequence actions in every status from $operationName many',
    async ({ buildOperation }) => {
      const originalFilter = { status: { in: ['COMPLETED', 'SCHEDULED'] } };

      const result = await buildOperation(accessService).execute(
        authContext,
        'linkedinAction',
        { filter: originalFilter },
      );

      expect(result.filter).toEqual({
        and: [
          {
            and: [
              originalFilter,
              { ownerWorkspaceMemberId: { eq: WORKSPACE_MEMBER_ID } },
            ],
          },
          {
            not: {
              or: [
                { sequenceEnrollmentId: { is: 'NOT_NULL' } },
                { sequenceStepId: { is: 'NOT_NULL' } },
                {
                  status: { in: CAP_COUNTED_LINKEDIN_ACTION_STATUSES },
                },
              ],
            },
          },
        ],
      });
    },
  );

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
