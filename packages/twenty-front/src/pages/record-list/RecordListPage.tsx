import { MAIN_CONTEXT_STORE_INSTANCE_ID } from '@/context-store/constants/MainContextStoreInstanceId';
import { contextStoreCurrentObjectMetadataItemIdComponentState } from '@/context-store/states/contextStoreCurrentObjectMetadataItemIdComponentState';
import { ContextStoreComponentInstanceContext } from '@/context-store/states/contexts/ContextStoreComponentInstanceContext';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useCreateManyRecords } from '@/object-record/hooks/useCreateManyRecords';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useObjectPermissions } from '@/object-record/hooks/useObjectPermissions';
import { RecordIndexContainerGater } from '@/object-record/record-index/components/RecordIndexContainerGater';
import { RecordIndexSkeletonLoader } from '@/object-record/record-index/components/RecordIndexSkeletonLoader';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { RecordListMembershipActions } from './components/RecordListMembershipActions';
import { StyledEmptyState } from './components/RecordListsPageStyles';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { isUndefined } from '@sniptt/guards';
import { t } from '@lingui/core/macro';
import { useCallback } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  AppPath,
  FeatureFlagKey,
  type RecordGqlOperationFilter,
  type RecordListType,
} from 'twenty-shared/types';

type RecordListRecord = ObjectRecord & {
  name: string;
  type: RecordListType;
  folder?: { id: string; name: string };
};

const OBJECT_NAME_BY_LIST_TYPE = {
  COMPANY: 'company',
  PERSON: 'person',
  OPPORTUNITY: 'opportunity',
} as const satisfies Record<RecordListType, string>;

const MEMBERSHIP_TARGET_FIELD_BY_LIST_TYPE = {
  COMPANY: 'targetCompanyId',
  PERSON: 'targetPersonId',
  OPPORTUNITY: 'targetOpportunityId',
} as const satisfies Record<RecordListType, string>;

export const RecordListPage = () => {
  const { recordListId } = useParams();
  const isRecordListsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  );
  const { record: recordList, loading } = useFindOneRecord<RecordListRecord>({
    objectNameSingular: 'recordList',
    objectRecordId: recordListId,
    recordGqlFields: {
      id: true,
      name: true,
      type: true,
      folder: { id: true, name: true },
    },
    skip: !isRecordListsEnabled,
  });
  const contextStoreCurrentObjectMetadataItemId = useAtomComponentStateValue(
    contextStoreCurrentObjectMetadataItemIdComponentState,
    MAIN_CONTEXT_STORE_INSTANCE_ID,
  );
  const { objectMetadataItems } = useObjectMetadataItems();
  const { objectPermissionsByObjectMetadataId } = useObjectPermissions();
  const apolloCoreClient = useApolloCoreClient();
  const { createManyRecords: createRecordListMembers } = useCreateManyRecords({
    objectNameSingular: 'recordListMember',
    skipPostOptimisticEffect: true,
  });

  const handleRecordCreated = useCallback(
    async (record: ObjectRecord) => {
      if (!recordListId || !recordList) {
        return;
      }

      const targetFieldName =
        MEMBERSHIP_TARGET_FIELD_BY_LIST_TYPE[recordList.type];

      await createRecordListMembers({
        recordsToCreate: [
          {
            recordListId,
            [targetFieldName]: record.id,
          },
        ],
        upsert: true,
      });
      await apolloCoreClient.refetchQueries({ include: 'active' });
    },
    [apolloCoreClient, createRecordListMembers, recordList, recordListId],
  );

  if (!isRecordListsEnabled) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  if (loading || !recordListId) {
    return <RecordIndexSkeletonLoader />;
  }

  if (!recordList) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  const objectMetadataItem = objectMetadataItems.find(
    (item) => item.nameSingular === OBJECT_NAME_BY_LIST_TYPE[recordList.type],
  );

  if (
    isUndefined(objectMetadataItem) ||
    contextStoreCurrentObjectMetadataItemId !== objectMetadataItem.id
  ) {
    return <RecordIndexSkeletonLoader />;
  }

  if (
    objectPermissionsByObjectMetadataId[objectMetadataItem.id]
      ?.canReadObjectRecords !== true
  ) {
    return (
      <PageContainer>
        <PageCardLayout header={<PageCardHeader title={recordList.name} />}>
          <StyledEmptyState>
            {t`You do not have permission to view this list's records.`}
          </StyledEmptyState>
        </PageCardLayout>
      </PageContainer>
    );
  }

  const requiredFilter = {
    recordListMemberships: {
      recordListId: { eq: recordListId },
    },
  } satisfies RecordGqlOperationFilter;
  const pageHeaderTag = recordList.folder?.name;

  return (
    <PageContainer>
      <ContextStoreComponentInstanceContext.Provider
        value={{ instanceId: MAIN_CONTEXT_STORE_INSTANCE_ID }}
      >
        <RecordIndexContainerGater
          requiredFilter={requiredFilter}
          onRecordCreated={handleRecordCreated}
          skipPostOptimisticEffectOnRecordCreate
          pageTitle={recordList.name}
          pageHeaderTag={pageHeaderTag}
          pageActions={
            <RecordListMembershipActions
              recordListId={recordListId}
              recordListType={recordList.type}
              targetObjectNameSingular={objectMetadataItem.nameSingular}
              requiredFilter={requiredFilter}
            />
          }
        />
      </ContextStoreComponentInstanceContext.Provider>
    </PageContainer>
  );
};
