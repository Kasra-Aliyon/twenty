import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { FieldMetadataType } from 'twenty-shared/types';

const ADDRESS_COUNTRY_SUB_FIELD_NAME = 'addressCountry';

type GetViewFieldDisplayArgs = {
  fieldMetadataItem: Pick<FieldMetadataItem, 'label' | 'type'>;
  subFieldName?: string | null;
};

export const getViewFieldDisplay = ({
  fieldMetadataItem,
  subFieldName,
}: GetViewFieldDisplayArgs) => {
  const isAddressCountryField =
    fieldMetadataItem.type === FieldMetadataType.ADDRESS &&
    subFieldName === ADDRESS_COUNTRY_SUB_FIELD_NAME;

  return {
    label: isAddressCountryField ? 'Country' : fieldMetadataItem.label,
    subFieldName: isAddressCountryField
      ? ADDRESS_COUNTRY_SUB_FIELD_NAME
      : subFieldName,
  };
};
