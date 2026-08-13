import { useActiveFieldMetadataItems } from '@/object-metadata/hooks/useActiveFieldMetadataItems';
import { useObjectMetadataItemById } from '@/object-metadata/hooks/useObjectMetadataItemById';
import { useUpdateRecordField } from '@/object-record/record-field/hooks/useUpdateRecordField';
import { useUpsertRecordField } from '@/object-record/record-field/hooks/useUpsertRecordField';
import { currentRecordFieldsComponentState } from '@/object-record/record-field/states/currentRecordFieldsComponentState';
import { type RecordField } from '@/object-record/record-field/types/RecordField';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuHeader } from '@/ui/layout/dropdown/components/DropdownMenuHeader/DropdownMenuHeader';
import { DropdownMenuHeaderLeftComponent } from '@/ui/layout/dropdown/components/DropdownMenuHeader/internal/DropdownMenuHeaderLeftComponent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { getViewFieldOptions } from '@/views/utils/getViewFieldOptions';
import { t } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { IconChevronLeft, IconEye, useIcons } from 'twenty-ui/icon';
import { MenuItem } from 'twenty-ui/navigation';
import { v4 } from 'uuid';
import { sortByProperty } from '~/utils/array/sortByProperty';

type RecordTableFieldsDropdownHiddenFieldsContentProps = {
  objectMetadataId: string;
  recordIndexId: string;
  onBack: () => void;
  onFieldUpdated?: (
    viewFieldId: string,
    update: Partial<{ isVisible: boolean }>,
  ) => void;
  onFieldCreated?: (recordField: RecordField) => void;
};

export const RecordTableFieldsDropdownHiddenFieldsContent = ({
  objectMetadataId,
  recordIndexId,
  onBack,
  onFieldUpdated,
  onFieldCreated,
}: RecordTableFieldsDropdownHiddenFieldsContentProps) => {
  const { objectMetadataItem } = useObjectMetadataItemById({
    objectId: objectMetadataId,
  });

  const { getIcon } = useIcons();

  const { upsertRecordField } = useUpsertRecordField(recordIndexId);

  const { updateRecordField } = useUpdateRecordField(recordIndexId);

  const currentRecordFields = useAtomComponentStateValue(
    currentRecordFieldsComponentState,
    recordIndexId,
  );

  const { activeFieldMetadataItems } = useActiveFieldMetadataItems({
    objectMetadataItem,
  });

  const hiddenFieldOptions = getViewFieldOptions({
    fieldMetadataItems: activeFieldMetadataItems,
    recordFields: currentRecordFields,
  }).filter(({ recordField }) => recordField?.isVisible !== true);

  const handleShowField = (
    fieldMetadataId: string,
    subFieldName?: string | null,
  ) => {
    const existingRecordField = currentRecordFields.find(
      (recordField) =>
        recordField.fieldMetadataItemId === fieldMetadataId &&
        (recordField.subFieldName ?? null) === (subFieldName ?? null),
    );

    if (isDefined(existingRecordField)) {
      updateRecordField(existingRecordField.id, { isVisible: true });
      onFieldUpdated?.(existingRecordField.id, { isVisible: true });
    } else {
      const lastPosition =
        currentRecordFields.toSorted(sortByProperty('position', 'desc'))?.[0]
          ?.position ?? 0;

      const newRecordField: RecordField = {
        id: v4(),
        fieldMetadataItemId: fieldMetadataId,
        size: 100,
        isVisible: true,
        position: lastPosition + 1,
        subFieldName,
      };

      upsertRecordField(newRecordField);
      onFieldCreated?.(newRecordField);
    }
  };

  return (
    <DropdownContent>
      <DropdownMenuHeader
        StartComponent={
          <DropdownMenuHeaderLeftComponent
            onClick={onBack}
            Icon={IconChevronLeft}
          />
        }
      >
        {t`Hidden Fields`}
      </DropdownMenuHeader>
      <DropdownMenuItemsContainer>
        {hiddenFieldOptions.map(
          ({ fieldMetadataItem, key, label, subFieldName }) => (
            <MenuItem
              key={key}
              LeftIcon={getIcon(fieldMetadataItem.icon)}
              iconButtons={[
                {
                  Icon: IconEye,
                  onClick: () =>
                    handleShowField(fieldMetadataItem.id, subFieldName),
                },
              ]}
              text={label}
            />
          ),
        )}
      </DropdownMenuItemsContainer>
    </DropdownContent>
  );
};
