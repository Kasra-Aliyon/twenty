import { type ResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

const WORKSPACE_QUERY_HOOK_TRANSACTION = Symbol(
  'workspace-query-hook-transaction',
);

type TransactionalResolverArgs = ResolverArgs & {
  [WORKSPACE_QUERY_HOOK_TRANSACTION]?: true;
};

export const markWorkspaceQueryForTransaction = <TArgs extends ResolverArgs>(
  args: TArgs,
): TArgs => {
  (args as TransactionalResolverArgs)[WORKSPACE_QUERY_HOOK_TRANSACTION] = true;

  return args;
};

export const shouldRunWorkspaceQueryInTransaction = (
  args: ResolverArgs,
): boolean =>
  (args as TransactionalResolverArgs)[WORKSPACE_QUERY_HOOK_TRANSACTION] ===
  true;
