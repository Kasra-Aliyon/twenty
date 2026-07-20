import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildRecordListMemberStandardFlatIndexMetadatas = (
  args: Omit<CreateStandardIndexArgs<'recordListMember'>, 'context'>,
): Record<
  AllStandardObjectIndexName<'recordListMember'>,
  FlatIndexMetadata
> => {
  const createTargetIndex = ({
    indexName,
    fieldName,
  }: {
    indexName: 'companyIdIndex' | 'personIdIndex' | 'opportunityIdIndex';
    fieldName: 'targetCompany' | 'targetPerson' | 'targetOpportunity';
  }) =>
    createStandardIndexFlatMetadata({
      ...args,
      context: { indexName, relatedFieldNames: [fieldName] },
    });

  const createUniqueTargetIndex = ({
    indexName,
    fieldName,
    columnName,
  }: {
    indexName:
      | 'companyListUniqueIndex'
      | 'personListUniqueIndex'
      | 'opportunityListUniqueIndex';
    fieldName: 'targetCompany' | 'targetPerson' | 'targetOpportunity';
    columnName: 'targetCompanyId' | 'targetPersonId' | 'targetOpportunityId';
  }) =>
    createStandardIndexFlatMetadata({
      ...args,
      context: {
        indexName,
        relatedFieldNames: [fieldName, 'recordList'],
        isUnique: true,
        indexWhereClause: `"deletedAt" IS NULL AND "${columnName}" IS NOT NULL`,
      },
    });

  return {
    recordListIdIndex: createStandardIndexFlatMetadata({
      ...args,
      context: {
        indexName: 'recordListIdIndex',
        relatedFieldNames: ['recordList'],
      },
    }),
    companyIdIndex: createTargetIndex({
      indexName: 'companyIdIndex',
      fieldName: 'targetCompany',
    }),
    personIdIndex: createTargetIndex({
      indexName: 'personIdIndex',
      fieldName: 'targetPerson',
    }),
    opportunityIdIndex: createTargetIndex({
      indexName: 'opportunityIdIndex',
      fieldName: 'targetOpportunity',
    }),
    companyListUniqueIndex: createUniqueTargetIndex({
      indexName: 'companyListUniqueIndex',
      fieldName: 'targetCompany',
      columnName: 'targetCompanyId',
    }),
    personListUniqueIndex: createUniqueTargetIndex({
      indexName: 'personListUniqueIndex',
      fieldName: 'targetPerson',
      columnName: 'targetPersonId',
    }),
    opportunityListUniqueIndex: createUniqueTargetIndex({
      indexName: 'opportunityListUniqueIndex',
      fieldName: 'targetOpportunity',
      columnName: 'targetOpportunityId',
    }),
  };
};
