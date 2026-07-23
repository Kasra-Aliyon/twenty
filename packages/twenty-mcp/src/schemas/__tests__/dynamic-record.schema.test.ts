import type { MetadataField, MetadataObject } from '../../types.js';
import {
  buildObjectInputSchema,
  validateRecordInput,
} from '../dynamic-record.schema.js';

const field = (
  name: string,
  type: string,
  overrides: Partial<MetadataField> = {},
): MetadataField => ({
  id: `${name}-id`,
  name,
  label: name,
  type,
  isNullable: false,
  ...overrides,
});

const personObject: MetadataObject = {
  id: 'person-object-id',
  nameSingular: 'person',
  namePlural: 'people',
  labelSingular: 'Person',
  labelPlural: 'People',
  fields: [
    field('id', 'UUID'),
    field('name', 'FULL_NAME'),
    field('emails', 'EMAILS'),
    field('status', 'SELECT', {
      options: [
        { value: 'ACTIVE', label: 'Active' },
        { value: 'INACTIVE', label: 'Inactive' },
      ],
    }),
    field('note', 'RICH_TEXT', { isNullable: true }),
    field('company', 'RELATION'),
  ],
};

describe('dynamic record schema', () => {
  it('validates composite fields, live enums, and relation IDs', () => {
    expect(
      validateRecordInput(personObject, {
        name: { firstName: 'Ada', lastName: 'Lovelace' },
        emails: {
          primaryEmail: 'ada@example.com',
          additionalEmails: ['ada@analytical.engine'],
        },
        status: 'ACTIVE',
        note: { blocknote: null, markdown: 'First programmer' },
        companyId: 'company-id',
      }),
    ).toEqual({
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      emails: {
        primaryEmail: 'ada@example.com',
        additionalEmails: ['ada@analytical.engine'],
      },
      status: 'ACTIVE',
      note: { blocknote: null, markdown: 'First programmer' },
      companyId: 'company-id',
    });
  });

  it('rejects invalid enum values before an API call', () => {
    expect(() =>
      validateRecordInput(personObject, { status: 'ARCHIVED' }),
    ).toThrow('Allowed values: ACTIVE, INACTIVE');
  });

  it('suggests the closest live field for a typo', () => {
    expect(() =>
      validateRecordInput(personObject, { sttaus: 'ACTIVE' }),
    ).toThrow('did you mean "status"?');
  });

  it('omits system-managed fields from writable input', () => {
    const schema = buildObjectInputSchema(personObject);

    expect(Object.keys(schema.shape)).not.toContain('id');
  });
});
