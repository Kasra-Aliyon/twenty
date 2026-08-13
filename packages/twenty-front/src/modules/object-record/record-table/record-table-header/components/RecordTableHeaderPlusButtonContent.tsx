import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useActiveFieldMetadataItems } from '@/object-metadata/hooks/useActiveFieldMetadataItems';
import { useChangeRecordFieldVisibility } from '@/object-record/record-field/hooks/useChangeRecordFieldVisibility';
import { currentRecordFieldsComponentState } from '@/object-record/record-field/states/currentRecordFieldsComponentState';
import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { DropdownMenuSearchInput } from '@/ui/layout/dropdown/components/DropdownMenuSearchInput';
import { DropdownMenuSeparator } from '@/ui/layout/dropdown/components/DropdownMenuSeparator';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { navigationMemorizedUrlState } from '@/ui/navigation/states/navigationMemorizedUrlState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import {
  getViewFieldOptions,
  type ViewFieldOption,
} from '@/views/utils/getViewFieldOptions';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { IconSettings, useIcons } from 'twenty-ui/icon';
import { MenuItem, UndecoratedLink } from 'twenty-ui/navigation';

export const RecordTableHeaderPlusButtonContent = () => {
  const { t } = useLingui();
  const [searchInput, setSearchInput] = useState('');

  const { objectMetadataItem, recordTableId } = useRecordTableContextOrThrow();

  const { closeDropdown } = useCloseDropdown();

  const { getIcon } = useIcons();

  const { changeRecordFieldVisibility } =
    useChangeRecordFieldVisibility(recordTableId);

  const handleAddColumn = useCallback(
    async ({ fieldMetadataItem, subFieldName }: ViewFieldOption) => {
      closeDropdown();
      await changeRecordFieldVisibility({
        fieldMetadataId: fieldMetadataItem.id,
        isVisible: true,
        subFieldName,
      });
    },
    [changeRecordFieldVisibility, closeDropdown],
  );

  const location = useLocation();
  const setNavigationMemorizedUrl = useSetAtomState(
    navigationMemorizedUrlState,
  );

  const { activeFieldMetadataItems } = useActiveFieldMetadataItems({
    objectMetadataItem,
  });

  const currentRecordFields = useAtomComponentStateValue(
    currentRecordFieldsComponentState,
    recordTableId,
  );

  const availableFieldOptionsToShow = getViewFieldOptions({
    fieldMetadataItems: activeFieldMetadataItems,
    recordFields: currentRecordFields,
  }).filter(({ recordField }) => recordField?.isVisible !== true);

  const filteredFieldOptions = availableFieldOptionsToShow.filter(({ label }) =>
    label.toLowerCase().includes(searchInput.toLowerCase()),
  );

  const hasAvailableFields = availableFieldOptionsToShow.length > 0;

  return (
    <DropdownContent>
      {hasAvailableFields && (
        <>
          <DropdownMenuSearchInput
            autoFocus
            value={searchInput}
            placeholder={t`Search fields`}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItemsContainer>
        {filteredFieldOptions.length > 0 ? (
          filteredFieldOptions.map((fieldOption) => (
            <MenuItem
              key={fieldOption.key}
              onClick={() => handleAddColumn(fieldOption)}
              LeftIcon={getIcon(fieldOption.fieldMetadataItem.icon)}
              text={fieldOption.label}
            />
          ))
        ) : (
          <MenuItem
            disabled
            accent="placeholder"
            text={
              hasAvailableFields
                ? t`No results`
                : t`All fields are already visible`
            }
          />
        )}
      </DropdownMenuItemsContainer>
      <DropdownMenuSeparator />
      <DropdownMenuItemsContainer scrollable={false}>
        <UndecoratedLink
          fullWidth
          to={getSettingsPath(SettingsPath.ObjectDetail, {
            objectNamePlural: objectMetadataItem.namePlural,
          })}
          onClick={() => {
            setNavigationMemorizedUrl(location.pathname + location.search);
          }}
        >
          <MenuItem LeftIcon={IconSettings} text={t`Customize fields`} />
        </UndecoratedLink>
      </DropdownMenuItemsContainer>
    </DropdownContent>
  );
};
