import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DEFAULT_CHARACTER_LIMIT } from '../constants.js';
import type { ResponseFormat } from '../types.js';
import { normalizeErrorMessage } from '../services/errors.js';

const formatScalar = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'number'
  ) {
    return String(value);
  }

  return JSON.stringify(value);
};

const getDisplayLabel = (record: Record<string, unknown>): string => {
  if (typeof record.name === 'string') {
    return record.name;
  }

  if (
    typeof record.name === 'object' &&
    record.name !== null &&
    'firstName' in record.name
  ) {
    const name = record.name as {
      firstName?: unknown;
      lastName?: unknown;
    };

    return [name.firstName, name.lastName]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
  }

  if (typeof record.title === 'string') {
    return record.title;
  }

  if (typeof record.label === 'string') {
    return record.label;
  }

  return typeof record.id === 'string' ? record.id : 'Record';
};

const toMarkdown = (value: unknown, depth = 0): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '_No items._';
    }

    return value
      .map((item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          return `- ${formatScalar(item)}`;
        }

        const record = item as Record<string, unknown>;
        const label = getDisplayLabel(record);
        const id = typeof record.id === 'string' ? ` (${record.id})` : '';
        const details = Object.entries(record)
          .filter(([key]) => key !== 'id' && key !== 'name' && key !== 'title')
          .slice(0, 10)
          .map(([key, fieldValue]) => `  - ${key}: ${formatScalar(fieldValue)}`)
          .join('\n');

        return `- ${label}${id}${details === '' ? '' : `\n${details}`}`;
      })
      .join('\n');
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;

    if (depth > 2) {
      return JSON.stringify(value, null, 2);
    }

    return Object.entries(record)
      .map(([key, fieldValue]) => {
        if (Array.isArray(fieldValue)) {
          return `### ${key}\n\n${toMarkdown(fieldValue, depth + 1)}`;
        }

        if (typeof fieldValue === 'object' && fieldValue !== null) {
          return `### ${key}\n\n${toMarkdown(fieldValue, depth + 1)}`;
        }

        return `- ${key}: ${formatScalar(fieldValue)}`;
      })
      .join('\n');
  }

  return formatScalar(value);
};

const safelyStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const formatToolResult = (
  value: unknown,
  responseFormat: ResponseFormat = 'markdown',
  characterLimit = DEFAULT_CHARACTER_LIMIT,
): CallToolResult => {
  const fullText =
    responseFormat === 'json' ? safelyStringify(value) : toMarkdown(value);
  const isTruncated = fullText.length > characterLimit;
  const text = isTruncated
    ? `${fullText.slice(0, characterLimit)}\n\n[Truncated at ${characterLimit} characters. Narrow the filter, reduce limit/depth, or continue with next_cursor.]`
    : fullText;

  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      result: isTruncated
        ? {
            preview: text,
            message:
              'Result exceeded the character limit. Narrow the query or paginate.',
          }
        : value,
      ...(isTruncated ? { truncated: true } : {}),
    },
  };
};

export const formatToolError = (error: unknown): CallToolResult => {
  const message = normalizeErrorMessage(error);

  return {
    content: [{ type: 'text', text: `Twenty request failed: ${message}` }],
    structuredContent: {
      result: { error: message },
    },
    isError: true,
  };
};

export const runTool = async (
  action: () => Promise<unknown>,
  responseFormat: ResponseFormat = 'markdown',
): Promise<CallToolResult> => {
  try {
    return formatToolResult(await action(), responseFormat);
  } catch (error) {
    return formatToolError(error);
  }
};

export const formatToolResultTesting = {
  getDisplayLabel,
  toMarkdown,
};
