import { z } from 'zod';

import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../constants.js';

export const responseFormatSchema = z
  .enum(['markdown', 'json'])
  .default('markdown')
  .describe('Response rendering. JSON is best for follow-up tool calls.');

export const depthSchema = z
  .number()
  .int()
  .min(0)
  .max(5)
  .default(0)
  .describe('Relation traversal depth. Keep at 0 or 1 unless needed.');

export const listLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_LIMIT)
  .default(DEFAULT_LIST_LIMIT);

export const recordDataSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Field/value map. Use twenty_describe_object first; relation IDs use <fieldName>Id.',
  );

export const objectSlugSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/)
  .describe('Exact plural object slug from twenty_list_objects.');

export const recordIdSchema = z.string().min(1).describe('Twenty record UUID.');

export const fieldsSchema = z
  .array(z.string().min(1))
  .max(100)
  .optional()
  .describe(
    'Optional response projection; id is always retained when available.',
  );

export const rawFilterSchema = z
  .string()
  .optional()
  .describe(
    'Twenty REST filter expression, for example stage[eq]:"PROPOSAL" or and(stage[eq]:"PROPOSAL",amount.amountMicros[gt]:1000).',
  );

export const orderBySchema = z
  .string()
  .optional()
  .describe(
    'Twenty REST order expression, for example createdAt[DescNullsLast].',
  );

export const TOOL_OUTPUT_SCHEMA = z.object({
  result: z.unknown(),
  truncated: z.boolean().optional(),
});

export const CONFIRMATION_DESCRIPTION =
  'Must be true after the user explicitly confirms the exact target and action.';
