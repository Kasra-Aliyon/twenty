import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildRecordListStandardFlatIndexMetadatas = (
  args: Omit<CreateStandardIndexArgs<'recordList'>, 'context'>,
): Record<AllStandardObjectIndexName<'recordList'>, FlatIndexMetadata> => ({
  folderIdIndex: createStandardIndexFlatMetadata({
    ...args,
    context: { indexName: 'folderIdIndex', relatedFieldNames: ['folder'] },
  }),
  folderPositionIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'folderPositionIndex',
      relatedFieldNames: ['folder', 'position'],
    },
  }),
  positionIndex: createStandardIndexFlatMetadata({
    ...args,
    context: { indexName: 'positionIndex', relatedFieldNames: ['position'] },
  }),
});
