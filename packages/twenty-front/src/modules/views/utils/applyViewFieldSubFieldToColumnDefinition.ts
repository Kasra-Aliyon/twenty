import {
  type FieldAddressMetadata,
  type FieldMetadata,
} from '@/object-record/record-field/ui/types/FieldMetadata';
import { type ColumnDefinition } from '@/object-record/record-table/types/ColumnDefinition';
import { FieldMetadataType } from 'twenty-shared/types';

export const applyViewFieldSubFieldToColumnDefinition = ({
  columnDefinition,
  subFieldName,
}: {
  columnDefinition: ColumnDefinition<FieldMetadata>;
  subFieldName?: string | null;
}): ColumnDefinition<FieldMetadata> => {
  const isAddressCountryColumn =
    columnDefinition.type === FieldMetadataType.ADDRESS &&
    subFieldName === 'addressCountry';

  if (!isAddressCountryColumn) {
    return { ...columnDefinition, subFieldName };
  }

  const addressMetadata = columnDefinition.metadata as FieldAddressMetadata;

  return {
    ...columnDefinition,
    label: 'Country',
    metadata: {
      ...addressMetadata,
      settings: {
        ...addressMetadata.settings,
        subFields: ['addressCountry'] as const,
      },
    },
    subFieldName,
  };
};
