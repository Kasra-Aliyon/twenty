import { getViewFieldDisplay } from '@/views/utils/getViewFieldDisplay';
import { FieldMetadataType } from 'twenty-shared/types';

describe('getViewFieldDisplay', () => {
  it('should expose an address country subfield as Country', () => {
    expect(
      getViewFieldDisplay({
        fieldMetadataItem: {
          label: 'Address',
          type: FieldMetadataType.ADDRESS,
        },
        subFieldName: 'addressCountry',
      }),
    ).toEqual({
      label: 'Country',
      subFieldName: 'addressCountry',
    });
  });

  it('should preserve the base Address field', () => {
    expect(
      getViewFieldDisplay({
        fieldMetadataItem: {
          label: 'Address',
          type: FieldMetadataType.ADDRESS,
        },
      }),
    ).toEqual({
      label: 'Address',
      subFieldName: undefined,
    });
  });
});
