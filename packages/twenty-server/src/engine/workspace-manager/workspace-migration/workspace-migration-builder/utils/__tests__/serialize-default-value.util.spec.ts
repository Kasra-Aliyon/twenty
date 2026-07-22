import { serializeDefaultValue } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/utils/serialize-default-value.util';

const BASE_ARGUMENTS = {
  schemaName: 'workspace_test',
  tableName: 'testObject',
  columnName: 'testField',
};

describe('serializeDefaultValue', () => {
  it('serializes arrays as JSON for jsonb columns', () => {
    expect(
      serializeDefaultValue({
        ...BASE_ARGUMENTS,
        columnType: 'jsonb',
        defaultValue: ['one', 'two'],
      }),
    ).toBe(`'["one","two"]'::jsonb`);
  });

  it('keeps PostgreSQL array serialization for array columns', () => {
    expect(
      serializeDefaultValue({
        ...BASE_ARGUMENTS,
        columnType: 'text',
        defaultValue: ['one', 'two'],
      }),
    ).toBe(`ARRAY['one','two']::text[]`);
  });
});
