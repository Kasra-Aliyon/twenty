import { useCreateEmptyRecordFilterFromFieldMetadataItem } from '@/object-record/record-filter/hooks/useCreateEmptyRecordFilterFromFieldMetadataItem';
import { useFilterableFieldMetadataItemsInRecordIndexContext } from '@/object-record/record-filter/hooks/useFilterableFieldMetadataItemsInRecordIndexContext';
import { useUpsertRecordFilter } from '@/object-record/record-filter/hooks/useUpsertRecordFilter';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { useOpenDropdown } from '@/ui/layout/dropdown/hooks/useOpenDropdown';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { getEditableChipDropdownId } from '@/views/editable-chip/utils/getEditableChipDropdownId';
import { useSetEditableFilterChipDropdownStates } from '@/views/hooks/useSetEditableFilterChipDropdownStates';
import { isDefined } from 'twenty-shared/utils';

export const useOpenRecordFilterChipFromTableHeader = () => {
  const { filterableFieldMetadataItems } =
    useFilterableFieldMetadataItemsInRecordIndexContext();

  const currentRecordFilters = useAtomComponentStateValue(
    currentRecordFiltersComponentState,
  );

  const { createEmptyRecordFilterFromFieldMetadataItem } =
    useCreateEmptyRecordFilterFromFieldMetadataItem();

  const { upsertRecordFilter } = useUpsertRecordFilter();

  const { openDropdown } = useOpenDropdown();

  const { setEditableFilterChipDropdownStates } =
    useSetEditableFilterChipDropdownStates();

  const openRecordFilterChipFromTableHeader = (
    fieldMetadataItemId: string,
    subFieldName?: string | null,
  ) => {
    const correspondingFieldMetadataItem = filterableFieldMetadataItems.find(
      (fieldMetadataItemToFind) =>
        fieldMetadataItemToFind.id === fieldMetadataItemId,
    );

    if (!isDefined(correspondingFieldMetadataItem)) {
      throw new Error(
        `Cannot find field metadata item with id : ${fieldMetadataItemId}`,
      );
    }

    const existingNonAdvancedRecordFilter = currentRecordFilters.find(
      (recordFilter) =>
        recordFilter.fieldMetadataId === fieldMetadataItemId &&
        (recordFilter.subFieldName ?? null) === (subFieldName ?? null) &&
        !isDefined(recordFilter.recordFilterGroupId),
    );

    if (isDefined(existingNonAdvancedRecordFilter)) {
      setEditableFilterChipDropdownStates(existingNonAdvancedRecordFilter);
      openDropdown({
        dropdownComponentInstanceIdFromProps: getEditableChipDropdownId({
          recordFilterId: existingNonAdvancedRecordFilter.id,
        }),
      });
      return;
    }

    const { newRecordFilter: emptyRecordFilter } =
      createEmptyRecordFilterFromFieldMetadataItem(
        correspondingFieldMetadataItem,
      );

    const newRecordFilter = {
      ...emptyRecordFilter,
      subFieldName: subFieldName as typeof emptyRecordFilter.subFieldName,
    };

    upsertRecordFilter(newRecordFilter);

    setEditableFilterChipDropdownStates(newRecordFilter);
    openDropdown({
      dropdownComponentInstanceIdFromProps: getEditableChipDropdownId({
        recordFilterId: newRecordFilter.id,
      }),
    });
  };

  return { openRecordFilterChipFromTableHeader };
};
