import { useCurrentCommandMenuContextApi } from '@/command-menu-item/hooks/useCurrentCommandMenuContextApi';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useCreateManyRecords } from '@/object-record/hooks/useCreateManyRecords';
import { useDeleteManyRecords } from '@/object-record/hooks/useDeleteManyRecords';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useLazyFindManyRecords } from '@/object-record/hooks/useLazyFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useOpenFormMultiRecordPicker } from '@/object-record/record-field/ui/form-types/hooks/useOpenFormMultiRecordPicker';
import { MultipleRecordPicker } from '@/object-record/record-picker/multiple-record-picker/components/MultipleRecordPicker';
import { multipleRecordPickerPickableMorphItemsComponentState } from '@/object-record/record-picker/multiple-record-picker/states/multipleRecordPickerPickableMorphItemsComponentState';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { t } from '@lingui/core/macro';
import { useStore } from 'jotai';
import { useMemo, useState } from 'react';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  RECORD_LIST_TYPES,
  type RecordGqlOperationFilter,
  type RecordListType,
} from 'twenty-shared/types';
import { IconMinus, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';

const MEMBERSHIP_TARGET_FIELD_BY_LIST_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: 'targetCompanyId',
  [RECORD_LIST_TYPES.PERSON]: 'targetPersonId',
  [RECORD_LIST_TYPES.OPPORTUNITY]: 'targetOpportunityId',
} as const;

export const RecordListMembershipActions = ({
  recordListId,
  recordListType,
  targetObjectNameSingular,
  requiredFilter,
}: {
  recordListId: string;
  recordListType: RecordListType;
  targetObjectNameSingular: string;
  requiredFilter: RecordGqlOperationFilter;
}) => {
  const pickerInstanceId = `record-list-add-records-${recordListId}`;
  const store = useStore();
  const apolloCoreClient = useApolloCoreClient();
  const { closeDropdown } = useCloseDropdown();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const [isSaving, setIsSaving] = useState(false);
  const { objectMetadataItem: recordListObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'recordList' });
  const recordListPermissions = useObjectPermissionsForObject(
    recordListObjectMetadataItem.id,
  );
  const { selectedRecords } = useCurrentCommandMenuContextApi();
  const targetFieldName = MEMBERSHIP_TARGET_FIELD_BY_LIST_TYPE[recordListType];

  const { records: currentTargetRecords } = useFindManyRecords({
    objectNameSingular: targetObjectNameSingular,
    filter: requiredFilter,
    recordGqlFields: { id: true },
    limit: QUERY_MAX_RECORDS,
  });
  const { createManyRecords } = useCreateManyRecords({
    objectNameSingular: 'recordListMember',
    skipPostOptimisticEffect: true,
  });
  const { deleteManyRecords } = useDeleteManyRecords({
    objectNameSingular: 'recordListMember',
  });
  const { findManyRecordsLazy: findSelectedMemberships } =
    useLazyFindManyRecords({
      objectNameSingular: 'recordListMember',
      filter: {
        recordListId: { eq: recordListId },
        [targetFieldName]: {
          in: selectedRecords.map((record) => record.id),
        },
      },
      recordGqlFields: { id: true },
      limit: QUERY_MAX_RECORDS,
      fetchPolicy: 'network-only',
    });
  const { openFormMultiRecordPicker } = useOpenFormMultiRecordPicker({
    objectNameSingular: targetObjectNameSingular,
  });

  const existingTargetIds = useMemo(
    () => new Set(currentTargetRecords.map((record) => record.id)),
    [currentTargetRecords],
  );

  if (!recordListPermissions.canUpdateObjectRecords) {
    return null;
  }

  const refreshActiveQueries = async () => {
    await apolloCoreClient.refetchQueries({ include: 'active' });
  };

  const handleOpenPicker = () => {
    openFormMultiRecordPicker({
      pickerInstanceId,
      selectedRecordIds: [...existingTargetIds],
      selectedRecords: currentTargetRecords,
    });
  };

  const handleAddRecords = async () => {
    const selectedTargetIds = store
      .get(
        multipleRecordPickerPickableMorphItemsComponentState.atomFamily({
          instanceId: pickerInstanceId,
        }),
      )
      .filter(({ isSelected }) => isSelected)
      .map(({ recordId }) => recordId)
      .filter((recordId) => !existingTargetIds.has(recordId));

    closeDropdown(pickerInstanceId);

    if (selectedTargetIds.length === 0) {
      return;
    }

    setIsSaving(true);

    try {
      await createManyRecords({
        recordsToCreate: selectedTargetIds.map((targetRecordId) => ({
          recordListId,
          [targetFieldName]: targetRecordId,
        })),
        upsert: true,
      });
      await refreshActiveQueries();
      enqueueSuccessSnackBar({ message: t`Records added to the list.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`Some records could not be added to the list.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveRecords = async () => {
    setIsSaving(true);

    try {
      const { records: selectedMemberships } = await findSelectedMemberships();
      const membershipIdsToDelete =
        selectedMemberships?.map((membership) => membership.id) ?? [];

      if (membershipIdsToDelete.length === 0) {
        return;
      }

      await deleteManyRecords({
        recordIdsToDelete: membershipIdsToDelete,
        skipOptimisticEffect: true,
      });
      await refreshActiveQueries();
      enqueueSuccessSnackBar({ message: t`Records removed from the list.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`Some records could not be removed from the list.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dropdown
        dropdownId={pickerInstanceId}
        dropdownPlacement="bottom-end"
        onOpen={handleOpenPicker}
        clickableComponent={
          <Button
            title={t`Add records`}
            Icon={IconPlus}
            variant="secondary"
            size="small"
            isLoading={isSaving}
          />
        }
        dropdownComponents={
          <MultipleRecordPicker
            componentInstanceId={pickerInstanceId}
            focusId={pickerInstanceId}
            onSubmit={handleAddRecords}
            onClickOutside={() => closeDropdown(pickerInstanceId)}
            layoutDirection="search-bar-on-top"
            dropdownWidth={GenericDropdownContentWidth.ExtraLarge}
            excludedRecordIds={[...existingTargetIds]}
          />
        }
      />
      <Button
        title={t`Remove from list`}
        Icon={IconMinus}
        variant="secondary"
        size="small"
        disabled={selectedRecords.length === 0 || isSaving}
        onClick={handleRemoveRecords}
      />
    </>
  );
};
