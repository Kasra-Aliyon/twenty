import { CommonQueryNames } from 'src/engine/api/common/types/common-query-args.type';
import {
  type CreateOneResolverArgs,
  type UpdateOneResolverArgs,
} from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type WorkspaceQueryHookStorage } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/storage/workspace-query-hook.storage';
import { type WorkspaceQueryHookExplorer } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.explorer';
import {
  markWorkspaceQueryForTransaction,
  shouldRunWorkspaceQueryInTransaction,
} from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import { WorkspaceQueryHookService } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.service';

describe('WorkspaceQueryHookService transactional hooks', () => {
  it('preserves a transaction marker returned on a fresh hook payload', async () => {
    const inputPayload = {
      id: 'record-id',
      data: { status: 'CLAIMED' },
    } as unknown as UpdateOneResolverArgs;
    const markedHookPayload = markWorkspaceQueryForTransaction({
      ...inputPayload,
      data: { status: 'COMPLETED' },
    });
    const workspaceQueryHookStorage = {
      getWorkspaceQueryPreHookInstances: jest.fn().mockReturnValue([
        {
          instance: { execute: jest.fn() },
          host: {},
          isRequestScoped: false,
        },
      ]),
    } as unknown as WorkspaceQueryHookStorage;
    const workspaceQueryHookExplorer = {
      handlePreHook: jest.fn().mockResolvedValue(markedHookPayload),
    } as unknown as WorkspaceQueryHookExplorer;
    const service = new WorkspaceQueryHookService(
      workspaceQueryHookStorage,
      workspaceQueryHookExplorer,
    );

    const result = await service.executePreQueryHooks(
      { workspace: { id: 'workspace-id' } } as WorkspaceAuthContext,
      'linkedinAction',
      CommonQueryNames.UPDATE_ONE,
      inputPayload,
    );

    expect(result).toBe(inputPayload);
    expect(shouldRunWorkspaceQueryInTransaction(result)).toBe(true);
  });

  it('replaces nested payload data with the authoritative normalized result', async () => {
    const hookInstance = {
      execute: jest.fn(),
      executeInTransaction: jest.fn(),
    };
    const normalizedPayload = {
      data: {
        sequenceId: 'sequence-id',
        sentEmailsByStepId: {},
      },
    } as CreateOneResolverArgs;
    const workspaceQueryHookStorage = {
      getWorkspaceQueryPreHookInstances: jest.fn().mockReturnValue([
        {
          instance: hookInstance,
          host: {},
          isRequestScoped: false,
        },
      ]),
    } as unknown as WorkspaceQueryHookStorage;
    const workspaceQueryHookExplorer = {
      handleTransactionalPreHook: jest
        .fn()
        .mockResolvedValue(normalizedPayload),
    } as unknown as WorkspaceQueryHookExplorer;
    const service = new WorkspaceQueryHookService(
      workspaceQueryHookStorage,
      workspaceQueryHookExplorer,
    );
    const inputPayload = {
      data: {
        sequenceId: 'sequence-id',
        sentEmailsByStepId: { attackerStep: { messageId: 'attacker-id' } },
      },
    } as unknown as CreateOneResolverArgs;

    const result = await service.executeTransactionalPreQueryHooks(
      { workspace: { id: 'workspace-id' } } as WorkspaceAuthContext,
      'sequenceEnrollment',
      CommonQueryNames.CREATE_ONE,
      inputPayload,
      {} as WorkspaceEntityManager,
    );

    expect(result).toBe(normalizedPayload);
    expect(result.data.sentEmailsByStepId).toEqual({});
  });
});
