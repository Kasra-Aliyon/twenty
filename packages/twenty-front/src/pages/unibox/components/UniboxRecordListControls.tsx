import { styled } from '@linaria/react';
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
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useCreateManyRecords } from '@/object-record/hooks/useCreateManyRecords';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
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

type UniboxRecordList = ObjectRecord & {
  name: string;
  type: RecordListType;
  folder: { id: string; name: string } | null;
};

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  height: 28px;
  max-width: 220px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

const useRecordLists = (type?: RecordListType) =>
  useFindManyRecords<UniboxRecordList>({
    objectNameSingular: 'recordList',
    filter: type ? { type: { eq: type } } : undefined,
    recordGqlFields: {
      id: true,
      name: true,
      type: true,
      folder: { id: true, name: true },
    },
    limit: QUERY_MAX_RECORDS,
  });

const UniboxRecordListFilterContent = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (recordListId: string | null) => void;
}) => {
  const { records } = useRecordLists();
  const listTypesInDisplayOrder = [
    RECORD_LIST_TYPES.OPPORTUNITY,
    RECORD_LIST_TYPES.COMPANY,
    RECORD_LIST_TYPES.PERSON,
  ];
  const sectionLabelByListType = {
    [RECORD_LIST_TYPES.OPPORTUNITY]: t`DEAL LISTS`,
    [RECORD_LIST_TYPES.COMPANY]: t`COMPANY LISTS`,
    [RECORD_LIST_TYPES.PERSON]: t`CONTACT LISTS`,
  };

  return (
    <StyledSelect
      aria-label={t`Filter by list`}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{t`All lists`}</option>
      {listTypesInDisplayOrder.map((listType) => {
        const listsForType = records.filter(
          (recordList) => recordList.type === listType,
        );

        if (listsForType.length === 0) return null;

        return (
          <optgroup key={listType} label={sectionLabelByListType[listType]}>
            {listsForType.map((recordList) => (
              <option key={recordList.id} value={recordList.id}>
                {recordList.folder?.name
                  ? `${recordList.folder.name} / ${recordList.name}`
                  : recordList.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </StyledSelect>
  );
};

export const UniboxRecordListFilter = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (recordListId: string | null) => void;
}) => {
  const isEnabled = useIsFeatureEnabled(FeatureFlagKey.IS_RECORD_LISTS_ENABLED);
  const metadataExists = useDoObjectMetadataItemsExist([
    'recordListFolder',
    'recordList',
    'recordListMember',
  ]);

  if (!isEnabled || !metadataExists) return null;

  return <UniboxRecordListFilterContent value={value} onChange={onChange} />;
};

const UniboxAddToRecordListContent = ({
  personIds,
  onRecordListSelected,
  disabled,
}: {
  personIds?: string[];
  onRecordListSelected?: (recordListId: string) => Promise<void>;
  disabled?: boolean;
}) => {
  const dropdownId = `unibox-add-to-list-${onRecordListSelected ? 'contacts' : 'threads'}`;
  const { records } = useRecordLists(RECORD_LIST_TYPES.PERSON);
  const { createManyRecords } = useCreateManyRecords({
    objectNameSingular: 'recordListMember',
    skipPostOptimisticEffect: true,
  });
  const { closeDropdown } = useCloseDropdown();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const [isSaving, setIsSaving] = useState(false);

  const listsByFolder = records.reduce<Record<string, UniboxRecordList[]>>(
    (groups, recordList) => {
      const folderName = recordList.folder?.name ?? t`No folder`;
      groups[folderName] = [...(groups[folderName] ?? []), recordList];
      return groups;
    },
    {},
  );

  const handleSelect = async (recordListId: string) => {
    closeDropdown(dropdownId);
    setIsSaving(true);

    try {
      if (onRecordListSelected) {
        await onRecordListSelected(recordListId);
      } else {
        const uniquePersonIds = [...new Set(personIds ?? [])];
        await createManyRecords({
          recordsToCreate: uniquePersonIds.map((targetPersonId) => ({
            recordListId,
            targetPersonId,
          })),
          upsert: true,
        });
      }
      enqueueSuccessSnackBar({ message: t`Contacts added to the list.` });
    } catch {
      enqueueErrorSnackBar({ message: t`Contacts could not be added.` });
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
          disabled={disabled || (!onRecordListSelected && !personIds?.length)}
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
                    onClick={() => void handleSelect(recordList.id)}
                  />
                ))}
              </div>
            ))}
            {records.length === 0 && (
              <MenuItem text={t`No contact lists`} disabled />
            )}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};

export const UniboxAddToRecordListButton = ({
  personIds,
  onRecordListSelected,
  disabled,
}: {
  personIds?: string[];
  onRecordListSelected?: (recordListId: string) => Promise<void>;
  disabled?: boolean;
}) => {
  const isEnabled = useIsFeatureEnabled(FeatureFlagKey.IS_RECORD_LISTS_ENABLED);
  const metadataExists = useDoObjectMetadataItemsExist([
    'recordListFolder',
    'recordList',
    'recordListMember',
  ]);

  if (!isEnabled || !metadataExists) return null;

  return (
    <UniboxAddToRecordListContent
      personIds={personIds}
      onRecordListSelected={onRecordListSelected}
      disabled={disabled}
    />
  );
};
