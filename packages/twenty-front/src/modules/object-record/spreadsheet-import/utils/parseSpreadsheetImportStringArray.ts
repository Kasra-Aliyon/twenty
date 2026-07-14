import { isNonEmptyString } from '@sniptt/guards';

export const parseSpreadsheetImportStringArray = (
  value: unknown,
): string[] | undefined => {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string') ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return [];
  }

  if (trimmedValue.startsWith('[')) {
    try {
      const parsedValue: unknown = JSON.parse(trimmedValue);

      return Array.isArray(parsedValue) &&
        parsedValue.every((item) => typeof item === 'string')
        ? parsedValue
        : undefined;
    } catch {
      return undefined;
    }
  }

  return trimmedValue
    .split(',')
    .map((item) => item.trim())
    .filter(isNonEmptyString);
};
