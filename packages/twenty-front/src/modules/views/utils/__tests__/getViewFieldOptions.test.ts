import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { type RecordField } from '@/object-record/record-field/types/RecordField';
import { getViewFieldOptions } from '@/views/utils/getViewFieldOptions';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

const companyAddressFieldMetadataItem = {
  id: 'company-address-field-id',
  label: 'Address',
  type: FieldMetadataType.ADDRESS,
  universalIdentifier:
    STANDARD_OBJECTS.company.fields.address.universalIdentifier,
} as FieldMetadataItem;

describe('getViewFieldOptions', () => {
  it('should expose separate Address and Country options for Companies', () => {
    const addressRecordField: RecordField = {
      id: 'address-view-field-id',
      fieldMetadataItemId: companyAddressFieldMetadataItem.id,
      isVisible: true,
      position: 1,
      size: 170,
    };

    expect(
      getViewFieldOptions({
        fieldMetadataItems: [companyAddressFieldMetadataItem],
        recordFields: [addressRecordField],
      }),
    ).toEqual([
      expect.objectContaining({
        key: 'company-address-field-id:',
        label: 'Address',
        recordField: addressRecordField,
        subFieldName: null,
      }),
      expect.objectContaining({
        key: 'company-address-field-id:addressCountry',
        label: 'Country',
        recordField: undefined,
        subFieldName: 'addressCountry',
      }),
    ]);
  });

  it('should associate an existing country view field with the Country option', () => {
    const countryRecordField: RecordField = {
      id: 'country-view-field-id',
      fieldMetadataItemId: companyAddressFieldMetadataItem.id,
      isVisible: false,
      position: 2,
      size: 130,
      subFieldName: 'addressCountry',
    };

    const options = getViewFieldOptions({
      fieldMetadataItems: [companyAddressFieldMetadataItem],
      recordFields: [countryRecordField],
    });

    expect(options[1]).toEqual(
      expect.objectContaining({
        label: 'Country',
        recordField: countryRecordField,
      }),
    );
  });

  it('should preserve a non-company country-only view field as one option', () => {
    const countryRecordField: RecordField = {
      id: 'person-country-view-field-id',
      fieldMetadataItemId: 'person-address-field-id',
      isVisible: true,
      position: 2,
      size: 130,
      subFieldName: 'addressCountry',
    };
    const personAddressFieldMetadataItem = {
      ...companyAddressFieldMetadataItem,
      id: 'person-address-field-id',
      universalIdentifier: 'person-address-universal-identifier',
    } as FieldMetadataItem;

    expect(
      getViewFieldOptions({
        fieldMetadataItems: [personAddressFieldMetadataItem],
        recordFields: [countryRecordField],
      }),
    ).toEqual([
      expect.objectContaining({
        label: 'Country',
        recordField: countryRecordField,
        subFieldName: 'addressCountry',
      }),
    ]);
  });
});
