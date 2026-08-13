import { useActiveFieldMetadataItems } from '@/object-metadata/hooks/useActiveFieldMetadataItems';
import { useObjectOptionsForBoard } from '@/object-record/object-options-dropdown/hooks/useObjectOptionsForBoard';
import { ObjectOptionsDropdownContext } from '@/object-record/object-options-dropdown/states/contexts/ObjectOptionsDropdownContext';
import { useChangeRecordFieldVisibility } from '@/object-record/record-field/hooks/useChangeRecordFieldVisibility';
import { currentRecordFieldsComponentState } from '@/object-record/record-field/states/currentRecordFieldsComponentState';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { ViewType } from '@/views/types/ViewType';
import { getViewFieldOptions } from '@/views/utils/getViewFieldOptions';
import { useContext } from 'react';
import { IconEye, useIcons } from 'twenty-ui/icon';
import { MenuItem } from 'twenty-ui/navigation';

export const ViewFieldsHiddenDropdownSection = () => {
  const { viewType, objectMetadataItem, recordIndexId } = useContext(
    ObjectOptionsDropdownContext,
  );

  const { changeRecordFieldVisibility } =
    useChangeRecordFieldVisibility(recordIndexId);

  const { handleBoardFieldVisibilityChange } = useObjectOptionsForBoard({
    objectNameSingular: objectMetadataItem.nameSingular,
    recordBoardId: recordIndexId,
    viewBarId: recordIndexId,
  });

  const handleChangeFieldVisibility =
    viewType === ViewType.KANBAN
      ? handleBoardFieldVisibilityChange
      : changeRecordFieldVisibility;

  const currentRecordFields = useAtomComponentStateValue(
    currentRecordFieldsComponentState,
  );

  const { activeFieldMetadataItems } = useActiveFieldMetadataItems({
    objectMetadataItem,
  });

  const availableFieldOptionsToShow = getViewFieldOptions({
    fieldMetadataItems: activeFieldMetadataItems,
    recordFields: currentRecordFields,
  }).filter(({ recordField }) => recordField?.isVisible !== true);

  const { getIcon } = useIcons();

  return (
    <>
      <DropdownMenuItemsContainer>
        {availableFieldOptionsToShow.length > 0 &&
          availableFieldOptionsToShow.map(
            ({ fieldMetadataItem, key, label, subFieldName }) => {
              return (
                <MenuItem
                  key={key}
                  LeftIcon={getIcon(fieldMetadataItem.icon)}
                  iconButtons={[
                    {
                      Icon: IconEye,
                      onClick: () =>
                        handleChangeFieldVisibility({
                          fieldMetadataId: fieldMetadataItem.id,
                          isVisible: true,
                          subFieldName,
                        }),
                    },
                  ]}
                  text={label}
                />
              );
            },
          )}
      </DropdownMenuItemsContainer>
    </>
  );
};
