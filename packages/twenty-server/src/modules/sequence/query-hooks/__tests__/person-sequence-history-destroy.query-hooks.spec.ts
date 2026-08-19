import { type FindOperator } from 'typeorm';

import {
  mockPersonFlatFieldMetadataMaps,
  mockPersonFlatObjectMetadataMaps,
} from 'src/engine/api/graphql/graphql-query-runner/__mocks__/mockPersonObjectMetadata';
import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { GraphqlQueryParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query.parser';
import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { shouldRunWorkspaceQueryInTransaction } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import {
  type ORMWorkspaceContext,
  withWorkspaceContext,
} from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { PersonSequenceHistoryDestroyGuardService } from 'src/modules/sequence/query-hooks/person-sequence-history-destroy-guard.service';
import {
  PersonSequenceHistoryDestroyManyPreQueryHook,
  PersonSequenceHistoryDestroyOnePreQueryHook,
  PersonSequenceHistoryMergeManyPreQueryHook,
} from 'src/modules/sequence/query-hooks/person-sequence-history-destroy.query-hooks';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const PERSON_ID = '20202020-2222-4222-8222-222222222222';
const SECOND_PERSON_ID = '20202020-3333-4333-8333-333333333333';
const EMPTY_TARGET_ID = '00000000-0000-0000-0000-000000000000';

describe('Person sequence history permanent-deletion guard', () => {
  const authContext = {
    type: 'system',
    workspace: { id: WORKSPACE_ID },
  } as WorkspaceAuthContext;
  const flatObjectMetadataMaps = mockPersonFlatObjectMetadataMaps([]);
  const flatFieldMetadataMaps = mockPersonFlatFieldMetadataMaps();
  const workspaceContext = {
    authContext,
    flatObjectMetadataMaps,
    flatFieldMetadataMaps,
    objectIdByNameSingular: { person: 'person-object-id' },
    userWorkspaceRoleMap: {},
    apiKeyRoleMap: {},
  } as unknown as ORMWorkspaceContext;
  const queryBuilder = {
    select: jest.fn(),
    withDeleted: jest.fn(),
    orderBy: jest.fn(),
    setLock: jest.fn(),
    getRawMany: jest.fn(),
  };
  const personRepository = {
    createQueryBuilder: jest.fn(),
  };
  const sequenceEnrollmentRepository = {
    findOne: jest.fn(),
  };
  const linkedinActionRepository = {
    findOne: jest.fn(),
  };
  const workspaceEntityManager = {
    internalContext: {
      workspaceId: WORKSPACE_ID,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      objectIdByNameSingular: { person: 'person-object-id' },
    },
    getRepository: jest.fn((objectName: string) => {
      if (objectName === 'person') return personRepository;
      if (objectName === 'sequenceEnrollment') {
        return sequenceEnrollmentRepository;
      }
      if (objectName === 'linkedinAction') return linkedinActionRepository;

      throw new Error(`Unexpected repository: ${objectName}`);
    }),
  } as unknown as WorkspaceEntityManager;

  let service: PersonSequenceHistoryDestroyGuardService;

  const runGuard = (
    filter: Partial<ObjectRecordFilter> = { id: { eq: PERSON_ID } },
  ) =>
    withWorkspaceContext(workspaceContext, () =>
      service.preparePermanentPersonDestroy({
        authContext,
        filter,
        workspaceEntityManager,
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.withDeleted.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.setLock.mockReturnValue(queryBuilder);
    queryBuilder.getRawMany.mockResolvedValue([{ id: PERSON_ID }]);
    personRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    sequenceEnrollmentRepository.findOne.mockResolvedValue(null);
    linkedinActionRepository.findOne.mockResolvedValue(null);
    jest
      .spyOn(GraphqlQueryParser.prototype, 'applyFilterToBuilder')
      .mockImplementation((builder) => builder);
    service = new PersonSequenceHistoryDestroyGuardService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('locks the exact permission-scoped destroy targets before checking history', async () => {
    const filter = { name: { firstName: { ilike: 'Ada' } } };

    await expect(runGuard(filter)).resolves.toEqual([PERSON_ID]);

    expect(workspaceEntityManager.getRepository).toHaveBeenNthCalledWith(
      1,
      'person',
      { shouldBypassPermissionChecks: true },
      authContext,
    );
    expect(
      GraphqlQueryParser.prototype.applyFilterToBuilder,
    ).toHaveBeenCalledWith(queryBuilder, 'person', filter);
    expect(queryBuilder.withDeleted).toHaveBeenCalledTimes(1);
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('person.id', 'ASC');
    expect(queryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
      undefined,
      ['person'],
    );

    const enrollmentOptions =
      sequenceEnrollmentRepository.findOne.mock.calls[0][0];
    const linkedinActionOptions =
      linkedinActionRepository.findOne.mock.calls[0][0];

    expect(enrollmentOptions).toEqual(
      expect.objectContaining({ withDeleted: true, select: ['id'] }),
    );
    expect(linkedinActionOptions).toEqual(
      expect.objectContaining({ withDeleted: true, select: ['id'] }),
    );
    expect(
      (enrollmentOptions.where.personId as FindOperator<string>).value,
    ).toEqual([PERSON_ID]);
    expect(
      (linkedinActionOptions.where.personId as FindOperator<string>).value,
    ).toEqual([PERSON_ID]);
  });

  it('rejects permanent deletion when any target has sequence enrollment history', async () => {
    sequenceEnrollmentRepository.findOne.mockResolvedValue({
      id: 'enrollment-id',
      deletedAt: new Date(),
    });

    await expect(runGuard()).rejects.toEqual(
      expect.objectContaining<Partial<CommonQueryRunnerException>>({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      }),
    );
    expect(linkedinActionRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects permanent deletion when any target has LinkedIn action history', async () => {
    linkedinActionRepository.findOne.mockResolvedValue({
      id: 'linkedin-action-id',
      deletedAt: new Date(),
    });

    await expect(runGuard()).rejects.toEqual(
      expect.objectContaining<Partial<CommonQueryRunnerException>>({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      }),
    );
  });

  it('does not query history tables when the destroy filter has no targets', async () => {
    queryBuilder.getRawMany.mockResolvedValue([]);

    await expect(runGuard()).resolves.toEqual([]);
    expect(sequenceEnrollmentRepository.findOne).not.toHaveBeenCalled();
    expect(linkedinActionRepository.findOne).not.toHaveBeenCalled();
  });

  it('deduplicates target ids while preserving the deterministic lock order', async () => {
    queryBuilder.getRawMany.mockResolvedValue([
      { id: PERSON_ID },
      { id: PERSON_ID },
      { id: SECOND_PERSON_ID },
    ]);

    await expect(runGuard()).resolves.toEqual([PERSON_ID, SECOND_PERSON_ID]);
  });

  it('blocks a Person merge when a source has only soft-deleted enrollment history', async () => {
    queryBuilder.getRawMany.mockResolvedValue([
      { id: PERSON_ID },
      { id: SECOND_PERSON_ID },
    ]);
    sequenceEnrollmentRepository.findOne.mockResolvedValue({
      id: 'archived-enrollment-id',
      deletedAt: new Date(),
    });
    const hook = new PersonSequenceHistoryMergeManyPreQueryHook(service);
    const payload = {
      ids: [SECOND_PERSON_ID, PERSON_ID],
      conflictPriorityIndex: 0,
    };

    const markedPayload = await hook.execute(authContext, 'person', payload);

    expect(shouldRunWorkspaceQueryInTransaction(markedPayload)).toBe(true);
    await expect(
      withWorkspaceContext(workspaceContext, () =>
        hook.executeInTransaction(
          authContext,
          'person',
          markedPayload,
          workspaceEntityManager,
        ),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CommonQueryRunnerException>>({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      }),
    );
    const enrollmentOptions =
      sequenceEnrollmentRepository.findOne.mock.calls[0][0];

    expect(
      (enrollmentOptions.where.personId as FindOperator<string>).value,
    ).toEqual([PERSON_ID]);
  });

  it('blocks a Person merge when a source has only soft-deleted LinkedIn action history', async () => {
    queryBuilder.getRawMany.mockResolvedValue([
      { id: PERSON_ID },
      { id: SECOND_PERSON_ID },
    ]);
    linkedinActionRepository.findOne.mockResolvedValue({
      id: 'archived-linkedin-action-id',
      deletedAt: new Date(),
    });
    const hook = new PersonSequenceHistoryMergeManyPreQueryHook(service);
    const payload = {
      ids: [SECOND_PERSON_ID, PERSON_ID],
      conflictPriorityIndex: 0,
    };

    const markedPayload = await hook.execute(authContext, 'person', payload);

    expect(shouldRunWorkspaceQueryInTransaction(markedPayload)).toBe(true);
    await expect(
      withWorkspaceContext(workspaceContext, () =>
        hook.executeInTransaction(
          authContext,
          'person',
          markedPayload,
          workspaceEntityManager,
        ),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CommonQueryRunnerException>>({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      }),
    );
    const linkedinActionOptions =
      linkedinActionRepository.findOne.mock.calls[0][0];

    expect(
      (linkedinActionOptions.where.personId as FindOperator<string>).value,
    ).toEqual([PERSON_ID]);
  });
});

describe('Person permanent-deletion query hooks', () => {
  const authContext = {
    type: 'system',
    workspace: { id: WORKSPACE_ID },
  } as WorkspaceAuthContext;
  const workspaceEntityManager = {} as WorkspaceEntityManager;
  const destroyGuardService = {
    preparePermanentPersonDestroy: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs destroyOne of a Person transactionally and checks the exact id', async () => {
    const hook = new PersonSequenceHistoryDestroyOnePreQueryHook(
      destroyGuardService as unknown as PersonSequenceHistoryDestroyGuardService,
    );
    const payload = { id: PERSON_ID };

    const markedPayload = await hook.execute(authContext, 'person', payload);

    expect(shouldRunWorkspaceQueryInTransaction(markedPayload)).toBe(true);

    await expect(
      hook.executeInTransaction(
        authContext,
        'person',
        markedPayload,
        workspaceEntityManager,
      ),
    ).resolves.toBe(markedPayload);
    expect(
      destroyGuardService.preparePermanentPersonDestroy,
    ).toHaveBeenCalledWith({
      authContext,
      filter: { id: { eq: PERSON_ID } },
      workspaceEntityManager,
    });
  });

  it('pins destroyMany to the ids checked under the transaction lock', async () => {
    destroyGuardService.preparePermanentPersonDestroy.mockResolvedValue([
      PERSON_ID,
      SECOND_PERSON_ID,
    ]);
    const hook = new PersonSequenceHistoryDestroyManyPreQueryHook(
      destroyGuardService as unknown as PersonSequenceHistoryDestroyGuardService,
    );
    const originalFilter = { jobTitle: { ilike: 'Founder' } };
    const payload = { filter: originalFilter };

    const markedPayload = await hook.execute(authContext, 'person', payload);

    expect(shouldRunWorkspaceQueryInTransaction(markedPayload)).toBe(true);
    const transactionalPayload = await hook.executeInTransaction(
      authContext,
      'person',
      markedPayload,
      workspaceEntityManager,
    );

    expect(transactionalPayload.filter).toEqual({
      id: { in: [PERSON_ID, SECOND_PERSON_ID] },
    });
    expect(
      destroyGuardService.preparePermanentPersonDestroy,
    ).toHaveBeenCalledWith({
      authContext,
      filter: originalFilter,
      workspaceEntityManager,
    });
  });

  it('pins an empty destroyMany result to a contradiction', async () => {
    destroyGuardService.preparePermanentPersonDestroy.mockResolvedValue([]);
    const hook = new PersonSequenceHistoryDestroyManyPreQueryHook(
      destroyGuardService as unknown as PersonSequenceHistoryDestroyGuardService,
    );
    const payload = { filter: { jobTitle: { ilike: 'Founder' } } };

    const result = await hook.executeInTransaction(
      authContext,
      'person',
      payload,
      workspaceEntityManager,
    );

    expect(result.filter).toEqual({
      and: [
        { id: { eq: EMPTY_TARGET_ID } },
        { not: { id: { eq: EMPTY_TARGET_ID } } },
      ],
    });
  });

  it('leaves hard deletes of unrelated objects unchanged', async () => {
    const hook = new PersonSequenceHistoryDestroyManyPreQueryHook(
      destroyGuardService as unknown as PersonSequenceHistoryDestroyGuardService,
    );
    const payload = { filter: { id: { eq: PERSON_ID } } };

    await expect(hook.execute(authContext, 'company', payload)).resolves.toBe(
      payload,
    );
    await expect(
      hook.executeInTransaction(
        authContext,
        'company',
        payload,
        workspaceEntityManager,
      ),
    ).resolves.toBe(payload);
    expect(
      destroyGuardService.preparePermanentPersonDestroy,
    ).not.toHaveBeenCalled();
  });

  it('checks only non-priority Person merge sources and leaves dry runs untouched', async () => {
    const hook = new PersonSequenceHistoryMergeManyPreQueryHook(
      destroyGuardService as unknown as PersonSequenceHistoryDestroyGuardService,
    );
    const payload = {
      ids: [PERSON_ID, SECOND_PERSON_ID],
      conflictPriorityIndex: 1,
    };

    const markedPayload = await hook.execute(authContext, 'person', payload);

    expect(shouldRunWorkspaceQueryInTransaction(markedPayload)).toBe(true);
    await expect(
      hook.executeInTransaction(
        authContext,
        'person',
        markedPayload,
        workspaceEntityManager,
      ),
    ).resolves.toBe(markedPayload);
    expect(
      destroyGuardService.preparePermanentPersonDestroy,
    ).toHaveBeenCalledWith({
      authContext,
      filter: { id: { in: [PERSON_ID, SECOND_PERSON_ID] } },
      personIdsToCheckForHistory: [PERSON_ID],
      workspaceEntityManager,
    });

    jest.clearAllMocks();

    const dryRunPayload = { ...payload, dryRun: true };

    await expect(
      hook.execute(authContext, 'person', dryRunPayload),
    ).resolves.toBe(dryRunPayload);
    await expect(
      hook.executeInTransaction(
        authContext,
        'person',
        dryRunPayload,
        workspaceEntityManager,
      ),
    ).resolves.toBe(dryRunPayload);
    expect(
      destroyGuardService.preparePermanentPersonDestroy,
    ).not.toHaveBeenCalled();
  });
});
