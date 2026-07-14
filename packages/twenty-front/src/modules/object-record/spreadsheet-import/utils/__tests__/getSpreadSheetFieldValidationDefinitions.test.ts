import { getSpreadSheetFieldValidationDefinitions } from '@/object-record/spreadsheet-import/utils/getSpreadSheetFieldValidationDefinitions';
import { FieldMetadataType } from '~/generated-metadata/graphql';

describe('getSpreadSheetFieldValidationDefinitions', () => {
  const [arrayValidationDefinition] = getSpreadSheetFieldValidationDefinitions(
    FieldMetadataType.ARRAY,
    'Technologies',
  );

  if (arrayValidationDefinition.rule !== 'function') {
    throw new Error('Expected an array function validation definition');
  }

  it('should accept a JSON string array', () => {
    expect(
      arrayValidationDefinition.isValid('["Salesforce", "SendGrid"]'),
    ).toBe(true);
  });

  it('should accept comma-separated values', () => {
    expect(
      arrayValidationDefinition.isValid(
        'Apple Business Manager, Microsoft 365 Apps & Services',
      ),
    ).toBe(true);
  });

  it('should reject a malformed JSON array', () => {
    expect(arrayValidationDefinition.isValid('["Salesforce"')).toBe(false);
  });
});
