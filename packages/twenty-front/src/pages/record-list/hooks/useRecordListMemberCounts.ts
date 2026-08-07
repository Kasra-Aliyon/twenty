import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { generateGroupByAggregateQuery } from '@/object-record/record-aggregate/utils/generateGroupByAggregateQuery';
import { type RecordIndexGroupByQueryResult } from '@/object-record/record-index/types/RecordIndexGroupByQueryResult';
import { getGroupByQueryResultGqlFieldName } from '@/page-layout/utils/getGroupByQueryResultGqlFieldName';
import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';

export const useRecordListMemberCounts = ({ skip }: { skip: boolean }) => {
  const apolloCoreClient = useApolloCoreClient();
  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular: 'recordListMember',
  });
  const objectPermissions = useObjectPermissionsForObject(
    objectMetadataItem.id,
  );

  const groupByQuery = useMemo(
    () =>
      generateGroupByAggregateQuery({
        objectMetadataItem,
        aggregateOperationGqlFields: ['totalCount'],
      }),
    [objectMetadataItem],
  );

  const queryResultFieldName =
    getGroupByQueryResultGqlFieldName(objectMetadataItem);

  const { data } = useQuery<RecordIndexGroupByQueryResult>(groupByQuery, {
    client: apolloCoreClient,
    skip: skip || !objectPermissions.canReadObjectRecords,
    variables: {
      groupBy: { recordListId: true },
      limit: QUERY_MAX_RECORDS,
    },
  });

  return (data?.[queryResultFieldName] ?? []).reduce<Record<string, number>>(
    (counts, group) => {
      const recordListId = group.groupByDimensionValues[0];

      if (recordListId) {
        counts[recordListId] = Number(group.totalCount);
      }

      return counts;
    },
    {},
  );
};
