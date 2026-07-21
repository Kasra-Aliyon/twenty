import { useCurrentCommandMenuContextApi } from '@/command-menu-item/hooks/useCurrentCommandMenuContextApi';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useCreateManyRecords } from '@/object-record/hooks/useCreateManyRecords';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { DropdownMenuSectionLabel } from '@/ui/layout/dropdown/components/DropdownMenuSectionLabel';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  FeatureFlagKey,
  RECORD_LIST_TYPES,
  type RecordListType,
} from 'twenty-shared/types';
import { IconListDetails } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

type CompatibleRecordList = ObjectRecord & {
  name: string;
  type: RecordListType;
  folderId: string | null;
  folder: { id: string; name: string } | null;
};

const LIST_TYPE_BY_OBJECT_NAME = {
  company: RECORD_LIST_TYPES.COMPANY,
  person: RECORD_LIST_TYPES.PERSON,
  opportunity: RECORD_LIST_TYPES.OPPORTUNITY,
} as const;

const TARGET_FIELD_BY_OBJECT_NAME = {
  company: 'targetCompanyId',
  person: 'targetPersonId',
  opportunity: 'targetOpportunityId',
} as const;

const AddToRecordListActionContent = ({
  objectNameSingular,
}: {
  objectNameSingular: string;
}) => {
  const dropdownId = 'add-selected-records-to-list';
  const { closeDropdown } = useCloseDropdown();
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const [isSaving, setIsSaving] = useState(false);
  const { selectedRecords } = useCurrentCommandMenuContextApi();
  const { objectMetadataItem: recordListObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'recordList' });
  const { objectMetadataItem: targetObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular });
  const recordListPermissions = useObjectPermissionsForObject(
    recordListObjectMetadataItem.id,
  );
  const listType =
    LIST_TYPE_BY_OBJECT_NAME[
      objectNameSingular as keyof typeof LIST_TYPE_BY_OBJECT_NAME
    ];
  const targetFieldName =
    TARGET_FIELD_BY_OBJECT_NAME[
      objectNameSingular as keyof typeof TARGET_FIELD_BY_OBJECT_NAME
    ];
  const { records: compatibleLists } = useFindManyRecords<CompatibleRecordList>(
    {
      objectNameSingular: 'recordList',
      filter: listType ? { type: { eq: listType } } : undefined,
      recordGqlFields: {
        id: true,
        name: true,
        type: true,
        folderId: true,
        folder: { id: true, name: true },
      },
      limit: QUERY_MAX_RECORDS,
      skip: !listType,
    },
  );
  const { createManyRecords } = useCreateManyRecords({
    objectNameSingular: 'recordListMember',
    skipPostOptimisticEffect: true,
  });

  if (
    !listType ||
    !targetFieldName ||
    !recordListPermissions.canUpdateObjectRecords ||
    selectedRecords.length === 0
  ) {
    return null;
  }

  const listsByFolder = compatibleLists.reduce<
    Record<string, CompatibleRecordList[]>
  >((accumulator, recordList) => {
    const folderName = recordList.folder?.name ?? t`No folder`;

    accumulator[folderName] = [...(accumulator[folderName] ?? []), recordList];

    return accumulator;
  }, {});

  const handleAddToList = async (recordListId: string) => {
    closeDropdown(dropdownId);
    setIsSaving(true);

    try {
      await createManyRecords({
        recordsToCreate: selectedRecords.map((record) => ({
          recordListId,
          [targetFieldName]: record.id,
        })),
        upsert: true,
      });
      await apolloCoreClient.refetchQueries({
        updateCache: (cache) => {
          cache.evict({ fieldName: targetObjectMetadataItem.namePlural });
        },
      });
      enqueueSuccessSnackBar({ message: t`Records added to the list.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`Some records could not be added to the list.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dropdown
      dropdownId={dropdownId}
      dropdownPlacement="bottom-end"
      clickableComponent={
        <Button
          title={t`Add to list`}
          Icon={IconListDetails}
          variant="secondary"
          size="small"
          isLoading={isSaving}
        />
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.ExtraLarge}>
          <DropdownMenuItemsContainer>
            {Object.entries(listsByFolder).map(([folderName, lists]) => (
              <div key={folderName}>
                <DropdownMenuSectionLabel label={folderName} />
                {lists.map((recordList) => (
                  <MenuItem
                    key={recordList.id}
                    LeftIcon={IconListDetails}
                    text={recordList.name}
                    onClick={() => void handleAddToList(recordList.id)}
                  />
                ))}
              </div>
            ))}
            {compatibleLists.length === 0 && (
              <MenuItem text={t`No compatible lists`} disabled />
            )}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};

export const AddToRecordListAction = ({
  objectNameSingular,
}: {
  objectNameSingular: string;
}) => {
  const isRecordListsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  );
  const doRecordListMetadataItemsExist = useDoObjectMetadataItemsExist([
    'recordListFolder',
    'recordList',
    'recordListMember',
  ]);

  if (!isRecordListsEnabled || !doRecordListMetadataItemsExist) {
    return null;
  }

  return (
    <AddToRecordListActionContent objectNameSingular={objectNameSingular} />
  );
};
