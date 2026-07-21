import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildSequenceEnrollmentStandardFlatIndexMetadatas = (
  args: Omit<CreateStandardIndexArgs<'sequenceEnrollment'>, 'context'>,
): Record<
  AllStandardObjectIndexName<'sequenceEnrollment'>,
  FlatIndexMetadata
> => ({
  sequenceIdIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'sequenceIdIndex',
      relatedFieldNames: ['sequence'],
    },
  }),
  personIdIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'personIdIndex',
      relatedFieldNames: ['person'],
    },
  }),
  personSequenceUniqueIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'personSequenceUniqueIndex',
      relatedFieldNames: ['person', 'sequence'],
      isUnique: true,
      indexWhereClause: '"deletedAt" IS NULL',
    },
  }),
  statusNextActionAtIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'statusNextActionAtIndex',
      relatedFieldNames: ['status', 'nextActionAt'],
    },
  }),
});
