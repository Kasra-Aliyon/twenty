import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { type RecordField } from '@/object-record/record-field/types/RecordField';
import { getViewFieldDisplay } from '@/views/utils/getViewFieldDisplay';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

const ADDRESS_COUNTRY_SUB_FIELD_NAME = 'addressCountry';

export type ViewFieldOption = {
  fieldMetadataItem: FieldMetadataItem;
  key: string;
  label: string;
  recordField?: RecordField;
  subFieldName?: string | null;
};

export const getViewFieldOptionKey = ({
  fieldMetadataId,
  subFieldName,
}: {
  fieldMetadataId: string;
  subFieldName?: string | null;
}) => `${fieldMetadataId}:${subFieldName ?? ''}`;

export const getViewFieldOptions = ({
  fieldMetadataItems,
  recordFields,
}: {
  fieldMetadataItems: FieldMetadataItem[];
  recordFields: RecordField[];
}): ViewFieldOption[] =>
  fieldMetadataItems.flatMap((fieldMetadataItem) => {
    const baseRecordField = recordFields.find(
      (recordField) =>
        recordField.fieldMetadataItemId === fieldMetadataItem.id &&
        (recordField.subFieldName ?? null) === null,
    );

    const baseOption: ViewFieldOption = {
      fieldMetadataItem,
      key: getViewFieldOptionKey({
        fieldMetadataId: fieldMetadataItem.id,
      }),
      label: fieldMetadataItem.label,
      recordField: baseRecordField,
      subFieldName: null,
    };

    const countryRecordField = recordFields.find(
      (recordField) =>
        recordField.fieldMetadataItemId === fieldMetadataItem.id &&
        recordField.subFieldName === ADDRESS_COUNTRY_SUB_FIELD_NAME,
    );

    const isCompanyAddress =
      fieldMetadataItem.type === FieldMetadataType.ADDRESS &&
      fieldMetadataItem.universalIdentifier ===
        STANDARD_OBJECTS.company.fields.address.universalIdentifier;

    if (!isCompanyAddress && countryRecordField === undefined) {
      return [baseOption];
    }

    const countryDisplay = getViewFieldDisplay({
      fieldMetadataItem,
      subFieldName: ADDRESS_COUNTRY_SUB_FIELD_NAME,
    });

    const countryOption: ViewFieldOption = {
      fieldMetadataItem,
      key: getViewFieldOptionKey({
        fieldMetadataId: fieldMetadataItem.id,
        subFieldName: ADDRESS_COUNTRY_SUB_FIELD_NAME,
      }),
      label: countryDisplay.label,
      recordField: countryRecordField,
      subFieldName: countryDisplay.subFieldName,
    };

    return isCompanyAddress ? [baseOption, countryOption] : [countryOption];
  });
