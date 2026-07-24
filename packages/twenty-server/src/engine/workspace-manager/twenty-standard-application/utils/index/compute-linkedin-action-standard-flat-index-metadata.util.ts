import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildLinkedinActionStandardFlatIndexMetadatas = (
  args: Omit<CreateStandardIndexArgs<'linkedinAction'>, 'context'>,
): Record<AllStandardObjectIndexName<'linkedinAction'>, FlatIndexMetadata> => ({
  statusScheduledAtIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'statusScheduledAtIndex',
      relatedFieldNames: ['status', 'scheduledAt'],
    },
  }),
  sequenceEnrollmentIdIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'sequenceEnrollmentIdIndex',
      relatedFieldNames: ['sequenceEnrollmentId'],
    },
  }),
  ownerStatusScheduledAtIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'ownerStatusScheduledAtIndex',
      relatedFieldNames: ['ownerWorkspaceMemberId', 'status', 'scheduledAt'],
    },
  }),
});
