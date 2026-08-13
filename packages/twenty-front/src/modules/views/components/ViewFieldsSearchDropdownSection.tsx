import { useActiveFieldMetadataItems } from '@/object-metadata/hooks/useActiveFieldMetadataItems';
import { getLabelIdentifierFieldMetadataItem } from '@/object-metadata/utils/getLabelIdentifierFieldMetadataItem';
import { useObjectOptionsForBoard } from '@/object-record/object-options-dropdown/hooks/useObjectOptionsForBoard';
import { ObjectOptionsDropdownContext } from '@/object-record/object-options-dropdown/states/contexts/ObjectOptionsDropdownContext';
import { useChangeRecordFieldVisibility } from '@/object-record/record-field/hooks/useChangeRecordFieldVisibility';
import { currentRecordFieldsComponentState } from '@/object-record/record-field/states/currentRecordFieldsComponentState';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { ViewType } from '@/views/types/ViewType';
import { getViewFieldOptions } from '@/views/utils/getViewFieldOptions';
import { useLingui } from '@lingui/react/macro';
import { useContext } from 'react';
import { IconEye, IconEyeOff, useIcons } from 'twenty-ui/icon';
import { MenuItem } from 'twenty-ui/navigation';

type ViewFieldsSearchDropdownSectionProps = {
  searchInput: string;
};

export const ViewFieldsSearchDropdownSection = ({
  searchInput,
}: ViewFieldsSearchDropdownSectionProps) => {
  const { t } = useLingui();
  const { getIcon } = useIcons();

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

  const { activeFieldMetadataItems } = useActiveFieldMetadataItems({
    objectMetadataItem,
  });

  const currentRecordFields = useAtomComponentStateValue(
    currentRecordFieldsComponentState,
  );

  const fieldMetadataItemLabelIdentifier =
    getLabelIdentifierFieldMetadataItem(objectMetadataItem);

  const filteredFields = getViewFieldOptions({
    fieldMetadataItems: activeFieldMetadataItems,
    recordFields: currentRecordFields,
  }).filter(({ label }) =>
    label.toLowerCase().includes(searchInput.toLowerCase()),
  );

  return (
    <DropdownMenuItemsContainer>
      {filteredFields.length > 0 ? (
        filteredFields.map(
          ({ fieldMetadataItem, key, recordField, label, subFieldName }) => {
            const isVisible = recordField?.isVisible === true;
            const isLabelIdentifier =
              fieldMetadataItem.id === fieldMetadataItemLabelIdentifier?.id;

            return (
              <MenuItem
                key={key}
                LeftIcon={getIcon(fieldMetadataItem.icon)}
                iconButtons={
                  isLabelIdentifier
                    ? undefined
                    : [
                        {
                          Icon: isVisible ? IconEyeOff : IconEye,
                          onClick: () =>
                            handleChangeFieldVisibility({
                              fieldMetadataId: fieldMetadataItem.id,
                              isVisible: !isVisible,
                              subFieldName,
                            }),
                        },
                      ]
                }
                text={label}
              />
            );
          },
        )
      ) : (
        <MenuItem disabled text={t`No results`} accent="placeholder" />
      )}
    </DropdownMenuItemsContainer>
  );
};
