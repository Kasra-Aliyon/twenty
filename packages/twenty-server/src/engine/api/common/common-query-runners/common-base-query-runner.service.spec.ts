import { type ObjectRecord } from 'twenty-shared/types';

import { CommonBaseQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-base-query-runner.service';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { type CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  type CommonExtendedInput,
  type CommonInput,
  CommonQueryNames,
  type UpdateOneQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { type GraphqlQueryParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query.parser';
import { markWorkspaceQueryForTransaction } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/utils/workspace-query-hook-transaction.util';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';

class TransactionTestQueryRunner extends CommonBaseQueryRunnerService<
  UpdateOneQueryArgs,
  ObjectRecord
> {
  protected readonly operationName = CommonQueryNames.UPDATE_ONE;
  readonly events: string[] = [];
  nestedRepository: unknown;

  protected async run(
    args: CommonExtendedInput<UpdateOneQueryArgs>,
    queryRunnerContext: CommonExtendedQueryRunnerContext,
  ): Promise<ObjectRecord> {
    this.events.push('write');
    this.nestedRepository =
      queryRunnerContext.workspaceDataSource.getRepository('sequenceStep');

    return { id: args.id };
  }

  protected async validate(): Promise<void> {}

  protected async computeArgs(
    args: CommonInput<UpdateOneQueryArgs>,
  ): Promise<CommonInput<UpdateOneQueryArgs>> {
    return args;
  }

  protected async processQueryResult(
    queryResult: ObjectRecord,
    _flatObjectMetadata: FlatObjectMetadata,
    _flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>,
    _flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>,
    _authContext: WorkspaceAuthContext,
  ): Promise<ObjectRecord> {
    this.events.push('enrich');

    return queryResult;
  }
}

describe('CommonBaseQueryRunnerService transactional hooks', () => {
  it('holds the transaction through validation, mutation, and lifecycle finalization', async () => {
    const runner = new TransactionTestQueryRunner();
    const authContext = {
      workspace: { id: 'workspace-id' },
    } as WorkspaceAuthContext;
    const transactionRepository = {
      marker: 'transaction-repository',
    } as unknown as WorkspaceRepository<ObjectRecord>;
    const transactionManager = {
      getRepository: jest.fn().mockReturnValue(transactionRepository),
    } as unknown as WorkspaceEntityManager;
    const workspaceDataSource = {
      transaction: jest.fn(async (callback) => {
        runner.events.push('begin');
        const result = await callback(transactionManager);

        runner.events.push('commit');

        return result;
      }),
    } as unknown as GlobalWorkspaceDataSource;
    const workspaceQueryHookService = {
      executeTransactionalPreQueryHooks: jest.fn(
        async (_authContext, _objectName, _methodName, payload, manager) => {
          expect(manager).toBe(transactionManager);
          runner.events.push('locked-validation');

          return payload;
        },
      ),
      executeTransactionalPostMutationHooks: jest.fn(
        async (
          _authContext,
          _objectName,
          _methodName,
          _payload,
          _result,
          manager,
        ) => {
          expect(manager).toBe(transactionManager);
          runner.events.push('finalize');
        },
      ),
      executePostQueryHooks: jest.fn(async () => {
        runner.events.push('post');
      }),
    };
    const flatObjectMetadata = {
      nameSingular: 'sequence',
    } as FlatObjectMetadata;
    const queryRunnerContext = {
      authContext,
      flatObjectMetadata,
      flatObjectMetadataMaps: {} as FlatEntityMaps<FlatObjectMetadata>,
      flatFieldMetadataMaps: {} as FlatEntityMaps<FlatFieldMetadata>,
    } as CommonBaseQueryRunnerContext;
    const extendedQueryRunnerContext = {
      ...queryRunnerContext,
      authContext,
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
      repository: {} as WorkspaceRepository<ObjectRecord>,
      workspaceDataSource,
    };

    Object.assign(runner, { workspaceQueryHookService });
    Object.defineProperty(
      runner,
      'prepareExtendedQueryRunnerContextWithGlobalDatasource',
      {
        value: jest.fn().mockResolvedValue(extendedQueryRunnerContext),
      },
    );

    const args = markWorkspaceQueryForTransaction({
      id: 'sequence-id',
      data: { status: 'PAUSED' },
      selectedFieldsResult: { select: { id: true } },
    } as unknown as CommonExtendedInput<UpdateOneQueryArgs>);
    const executeQueryAndEnrichResults = (
      runner as unknown as {
        executeQueryAndEnrichResults: (
          processedArgs: CommonExtendedInput<UpdateOneQueryArgs>,
          context: CommonBaseQueryRunnerContext,
          parser: GraphqlQueryParser,
        ) => Promise<ObjectRecord>;
      }
    ).executeQueryAndEnrichResults.bind(runner);

    await expect(
      executeQueryAndEnrichResults(
        args,
        queryRunnerContext,
        {} as GraphqlQueryParser,
      ),
    ).resolves.toEqual({ id: 'sequence-id' });

    expect(runner.events).toEqual([
      'begin',
      'locked-validation',
      'write',
      'finalize',
      'commit',
      'enrich',
      'post',
    ]);
    expect(runner.nestedRepository).toBe(transactionRepository);
  });
});
