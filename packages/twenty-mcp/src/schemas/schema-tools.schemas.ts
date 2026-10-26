import { z } from 'zod';

import {
  CONFIRMATION_DESCRIPTION,
  objectSlugSchema,
  responseFormatSchema,
} from './common.schemas.js';

const nameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/);
const labelSchema = z.string().trim().min(1);
const displayFields = {
  description: z.string().optional(),
  icon: z.string().optional(),
};
const confirmationFields = {
  confirm: z.boolean().default(false).describe(CONFIRMATION_DESCRIPTION),
  response_format: responseFormatSchema,
};

const optionSchema = z.strictObject({
  value: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
  label: labelSchema,
  color: z
    .enum([
      'red',
      'ruby',
      'crimson',
      'tomato',
      'orange',
      'amber',
      'yellow',
      'lime',
      'grass',
      'green',
      'jade',
      'mint',
      'turquoise',
      'cyan',
      'sky',
      'blue',
      'iris',
      'violet',
      'purple',
      'plum',
      'pink',
      'bronze',
      'gold',
      'brown',
      'gray',
    ])
    .optional(),
});

const optionsSchema = z
  .array(optionSchema)
  .min(1)
  .refine(
    (options) =>
      new Set(options.map((option) => option.value)).size === options.length,
    'Option values must be unique.',
  );

export const createObjectSchema = z.strictObject({
  name_singular: nameSchema,
  name_plural: nameSchema,
  label_singular: labelSchema,
  label_plural: labelSchema,
  ...displayFields,
  ...confirmationFields,
});

export const updateObjectSchema = z.strictObject({
  object: objectSlugSchema,
  changes: z
    .strictObject({
      label_singular: labelSchema.optional(),
      label_plural: labelSchema.optional(),
      ...displayFields,
    })
    .refine(
      (changes) => Object.values(changes).some((value) => value !== undefined),
      'Provide at least one change.',
    ),
  ...confirmationFields,
});

export const createFieldSchema = z.strictObject({
  object: objectSlugSchema,
  name: nameSchema,
  label: labelSchema,
  type: z.enum([
    'ADDRESS',
    'ARRAY',
    'BOOLEAN',
    'CURRENCY',
    'DATE',
    'DATE_TIME',
    'EMAILS',
    'FILES',
    'FULL_NAME',
    'LINKS',
    'MULTI_SELECT',
    'NUMBER',
    'NUMERIC',
    'PHONES',
    'RATING',
    'RAW_JSON',
    'RELATION',
    'RICH_TEXT',
    'TEXT',
    'SELECT',
  ]),
  ...displayFields,
  options: optionsSchema.optional(),
  default_value: z
    .unknown()
    .optional()
    .describe(
      'Select defaults accept an option value or null; multi-select defaults accept an array of option values. Other types use the metadata API format.',
    ),
  settings: z.record(z.string(), z.unknown()).optional(),
  relation: z
    .strictObject({
      target_object: objectSlugSchema,
      type: z.enum(['MANY_TO_ONE', 'ONE_TO_MANY']).default('MANY_TO_ONE'),
      inverse_label: labelSchema,
      inverse_icon: z.string().min(1).default('IconLink'),
    })
    .optional(),
  ...confirmationFields,
});

export const updateFieldSchema = z.strictObject({
  object: objectSlugSchema,
  field: nameSchema,
  changes: z
    .strictObject({
      label: labelSchema.optional(),
      ...displayFields,
      options: optionsSchema.optional(),
      default_value: z.unknown().optional(),
      is_active: z.boolean().optional(),
    })
    .refine(
      (changes) => Object.values(changes).some((value) => value !== undefined),
      'Provide at least one change.',
    ),
  allow_option_removal: z
    .boolean()
    .default(false)
    .describe(
      'Only enable after confirming the exact option removals. Records holding removed options lose those values.',
    ),
  ...confirmationFields,
});

export type CreateObjectArguments = z.infer<typeof createObjectSchema>;
export type UpdateObjectArguments = z.infer<typeof updateObjectSchema>;
export type CreateFieldArguments = z.infer<typeof createFieldSchema>;
export type UpdateFieldArguments = z.infer<typeof updateFieldSchema>;
