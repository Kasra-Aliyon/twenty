import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildLinkedinConnectionStandardFlatIndexMetadatas = (
  args: Omit<CreateStandardIndexArgs<'linkedinConnection'>, 'context'>,
): Record<
  AllStandardObjectIndexName<'linkedinConnection'>,
  FlatIndexMetadata
> => ({
  externalIdUniqueIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'externalIdUniqueIndex',
      relatedFieldNames: ['externalId', 'ownerWorkspaceMemberId'],
      isUnique: true,
      indexWhereClause: '"deletedAt" IS NULL',
    },
  }),
});
