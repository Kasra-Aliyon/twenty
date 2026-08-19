import { type QueryResultFieldValue } from 'src/engine/api/graphql/workspace-query-runner/factories/query-result-getters/interfaces/query-result-field-value';
import { type ResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';

export interface WorkspacePreQueryHookInstance {
  execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: ResolverArgs,
  ): Promise<ResolverArgs>;

  executeInTransaction?(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: ResolverArgs,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<ResolverArgs>;

  executeAfterMutationInTransaction?(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: ResolverArgs,
    result: QueryResultFieldValue,
    workspaceEntityManager: WorkspaceEntityManager,
  ): Promise<void>;
}

export interface WorkspacePostQueryHookInstance {
  execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: QueryResultFieldValue,
  ): Promise<void>;
}
