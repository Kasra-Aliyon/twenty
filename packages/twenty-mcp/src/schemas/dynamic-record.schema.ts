import { z } from 'zod';

import type { MetadataField, MetadataObject } from '../types.js';
import { TwentyApiError } from '../services/errors.js';

const SYSTEM_MANAGED_FIELDS = new Set([
  'createdAt',
  'createdBy',
  'deletedAt',
  'id',
  'searchVector',
  'updatedAt',
  'updatedBy',
]);

const isDateString = (value: string): boolean =>
  !Number.isNaN(Date.parse(value));

const nullableString = z.string().nullable().optional();

const fullNameSchema = z.object({
  firstName: nullableString,
  lastName: nullableString,
});

const emailsSchema = z.object({
  primaryEmail: nullableString,
  additionalEmails: z.array(z.string().email()).nullable().optional(),
});

const phonesSchema = z.object({
  primaryPhoneNumber: nullableString,
  primaryPhoneCountryCode: nullableString,
  primaryPhoneCallingCode: nullableString,
  additionalPhones: z
    .array(
      z.object({
        number: z.string(),
        countryCode: nullableString,
        callingCode: nullableString,
      }),
    )
    .nullable()
    .optional(),
});

const linksSchema = z.object({
  primaryLinkUrl: nullableString,
  primaryLinkLabel: nullableString,
  secondaryLinks: z
    .array(
      z.object({
        url: z.string(),
        label: nullableString,
      }),
    )
    .nullable()
    .optional(),
});

const currencySchema = z.object({
  amountMicros: z.number().finite().nullable().optional(),
  currencyCode: nullableString,
});

const addressSchema = z.object({
  addressStreet1: nullableString,
  addressStreet2: nullableString,
  addressCity: nullableString,
  addressPostcode: nullableString,
  addressState: nullableString,
  addressCountry: nullableString,
  addressLat: z.number().finite().nullable().optional(),
  addressLng: z.number().finite().nullable().optional(),
});

const richTextSchema = z.object({
  blocknote: nullableString,
  markdown: nullableString,
});

const schemaForField = (field: MetadataField): z.ZodType => {
  const optionValues = field.options?.map((option) => option.value) ?? [];
  let schema: z.ZodType;

  switch (field.type) {
    case 'BOOLEAN':
      schema = z.boolean();
      break;
    case 'DATE':
    case 'DATE_TIME':
      schema = z
        .string()
        .refine(isDateString, `${field.name} must be an ISO date or date-time`);
      break;
    case 'MULTI_SELECT':
      schema =
        optionValues.length === 0
          ? z.array(z.string())
          : z.array(
              z
                .string()
                .refine(
                  (value) => optionValues.includes(value),
                  `Allowed values: ${optionValues.join(', ')}`,
                ),
            );
      break;
    case 'NUMBER':
    case 'NUMERIC':
    case 'POSITION':
      schema = z.number().finite();
      break;
    case 'RATING':
    case 'SELECT':
      schema =
        optionValues.length === 0
          ? z.string()
          : z
              .string()
              .refine(
                (value) => optionValues.includes(value),
                `Allowed values: ${optionValues.join(', ')}`,
              );
      break;
    case 'TEXT':
    case 'UUID':
      schema = z.string();
      break;
    case 'FULL_NAME':
      schema = fullNameSchema;
      break;
    case 'EMAILS':
      schema = emailsSchema;
      break;
    case 'PHONES':
      schema = phonesSchema;
      break;
    case 'LINKS':
      schema = linksSchema;
      break;
    case 'CURRENCY':
      schema = currencySchema;
      break;
    case 'ADDRESS':
      schema = addressSchema;
      break;
    case 'RICH_TEXT':
      schema = richTextSchema;
      break;
    case 'FILES':
      schema = z.array(
        z.object({
          fileId: z.string(),
          label: nullableString,
        }),
      );
      break;
    case 'ARRAY':
      schema = z.array(z.unknown());
      break;
    default:
      schema = z.unknown();
  }

  return field.isNullable === true ? schema.nullable() : schema;
};

const levenshteinDistance = (left: string, right: string): number => {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? Math.max(left.length, right.length);
};

const findSuggestion = (
  invalidField: string,
  validFields: string[],
): string | undefined => {
  const suggestions = validFields
    .map((field) => ({
      field,
      distance: levenshteinDistance(
        invalidField.toLocaleLowerCase(),
        field.toLocaleLowerCase(),
      ),
    }))
    .sort((left, right) => left.distance - right.distance);
  const best = suggestions[0];

  if (
    best === undefined ||
    best.distance > Math.max(2, Math.floor(invalidField.length / 3))
  ) {
    return undefined;
  }

  return best.field;
};

export const buildObjectInputSchema = (
  object: MetadataObject,
): z.ZodObject<Record<string, z.ZodType>> => {
  const shape: Record<string, z.ZodType> = {};

  for (const field of object.fields) {
    if (!SYSTEM_MANAGED_FIELDS.has(field.name)) {
      shape[field.name] = schemaForField(field).optional();

      if (field.type === 'RELATION' || field.type === 'MORPH_RELATION') {
        shape[`${field.name}Id`] = z.string().nullable().optional();
      }
    }
  }

  return z.object(shape).strict();
};

export const validateRecordInput = (
  object: MetadataObject,
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const schema = buildObjectInputSchema(object);
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const validFields = Object.keys(schema.shape);
  const messages = result.error.issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys
        .map((key) => {
          const suggestion = findSuggestion(key, validFields);

          return suggestion === undefined
            ? `field "${key}" does not exist`
            : `field "${key}" does not exist; did you mean "${suggestion}"?`;
        })
        .join('; ');
    }

    const path = issue.path.join('.');

    return `${path === '' ? 'record' : path}: ${issue.message}`;
  });

  throw new TwentyApiError({
    message: `Invalid ${object.nameSingular} input: ${messages.join('; ')}`,
    code: 'INVALID_RECORD_INPUT',
    details: result.error.flatten(),
  });
};

export const dynamicRecordSchemaTesting = {
  findSuggestion,
  levenshteinDistance,
  schemaForField,
};
