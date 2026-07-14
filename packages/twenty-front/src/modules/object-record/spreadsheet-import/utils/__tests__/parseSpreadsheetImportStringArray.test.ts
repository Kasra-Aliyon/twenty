import { parseSpreadsheetImportStringArray } from '@/object-record/spreadsheet-import/utils/parseSpreadsheetImportStringArray';

describe('parseSpreadsheetImportStringArray', () => {
  it('should parse a JSON string array', () => {
    expect(
      parseSpreadsheetImportStringArray('["market access", "b2b"]'),
    ).toEqual(['market access', 'b2b']);
  });

  it('should parse comma-separated values and preserve spaces and special characters', () => {
    expect(
      parseSpreadsheetImportStringArray(
        'Microsoft 365 Apps & Services, Google Analytics 4 (GA4), WordPress.org',
      ),
    ).toEqual([
      'Microsoft 365 Apps & Services',
      'Google Analytics 4 (GA4)',
      'WordPress.org',
    ]);
  });

  it('should remove empty comma-separated values', () => {
    expect(
      parseSpreadsheetImportStringArray('Salesforce, , SendGrid,'),
    ).toEqual(['Salesforce', 'SendGrid']);
  });

  it('should reject malformed JSON arrays', () => {
    expect(parseSpreadsheetImportStringArray('["Salesforce"')).toBeUndefined();
  });

  it('should reject JSON arrays containing non-string values', () => {
    expect(
      parseSpreadsheetImportStringArray('["Salesforce", 123]'),
    ).toBeUndefined();
  });
});
