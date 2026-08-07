import {
  type FieldAddressMetadata,
  type FieldMetadata,
} from '@/object-record/record-field/ui/types/FieldMetadata';
import { type ColumnDefinition } from '@/object-record/record-table/types/ColumnDefinition';
import { mapArrayToObject } from '~/utils/array/mapArrayToObject';
import { moveArrayItem } from '~/utils/array/moveArrayItem';
import { isUndefinedOrNull } from '~/utils/isUndefinedOrNull';

import { isDefined } from 'twenty-shared/utils';
import { type ViewField } from '@/views/types/ViewField';
import { FieldMetadataType } from 'twenty-shared/types';

export const mapViewFieldsToColumnDefinitions = ({
  columnDefinitions,
  viewFields,
}: {
  columnDefinitions: ColumnDefinition<FieldMetadata>[];
  viewFields: ViewField[];
}): ColumnDefinition<FieldMetadata>[] => {
  let labelIdentifierFieldMetadataId = '';

  const columnDefinitionsByFieldMetadataId = mapArrayToObject(
    columnDefinitions,
    ({ fieldMetadataId }) => fieldMetadataId,
  );

  const columnDefinitionsFromViewFields = viewFields
    .map((viewField) => {
      const correspondingColumnDefinition =
        columnDefinitionsByFieldMetadataId[viewField.fieldMetadataId];

      if (isUndefinedOrNull(correspondingColumnDefinition)) return null;

      const { isLabelIdentifier } = correspondingColumnDefinition;

      const isAddressCountryColumn =
        correspondingColumnDefinition.type === FieldMetadataType.ADDRESS &&
        viewField.subFieldName === 'addressCountry';

      const addressMetadata =
        correspondingColumnDefinition.metadata as FieldAddressMetadata;

      const columnMetadata = isAddressCountryColumn
        ? {
            ...addressMetadata,
            settings: {
              ...addressMetadata.settings,
              subFields: ['addressCountry'] as const,
            },
          }
        : correspondingColumnDefinition.metadata;

      if (isLabelIdentifier === true) {
        labelIdentifierFieldMetadataId =
          correspondingColumnDefinition.fieldMetadataId;
      }

      return {
        fieldMetadataId: viewField.fieldMetadataId,
        label: isAddressCountryColumn
          ? 'Country'
          : correspondingColumnDefinition.label,
        metadata: columnMetadata,
        iconName: correspondingColumnDefinition.iconName,
        type: correspondingColumnDefinition.type,
        position: isLabelIdentifier ? 0 : viewField.position,
        size: viewField.size ?? correspondingColumnDefinition.size,
        isLabelIdentifier,
        isVisible: isLabelIdentifier || viewField.isVisible,
        viewFieldId: viewField.id,
        subFieldName: viewField.subFieldName,
        isUIEditable: correspondingColumnDefinition.metadata.isUIEditable,
        isSortable: correspondingColumnDefinition.isSortable,
        isFilterable: correspondingColumnDefinition.isFilterable,
        defaultValue: correspondingColumnDefinition.defaultValue,
        settings:
          'settings' in correspondingColumnDefinition.metadata
            ? correspondingColumnDefinition.metadata.settings
            : undefined,
      } as ColumnDefinition<FieldMetadata>;
    })
    .filter(isDefined);

  // No label identifier set for this object
  if (!labelIdentifierFieldMetadataId) return columnDefinitionsFromViewFields;

  const labelIdentifierIndex = columnDefinitionsFromViewFields.findIndex(
    ({ fieldMetadataId }) => fieldMetadataId === labelIdentifierFieldMetadataId,
  );

  // Label identifier field found in view fields
  // => move it to the start of the list
  return moveArrayItem(columnDefinitionsFromViewFields, {
    fromIndex: labelIdentifierIndex,
    toIndex: 0,
  });
};
