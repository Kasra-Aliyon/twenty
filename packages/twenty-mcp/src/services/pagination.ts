import type { NormalizedListResponse } from '../types.js';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getItems = (response: unknown, objectPlural: string): unknown[] => {
  if (!isRecord(response) || !isRecord(response.data)) {
    return [];
  }

  const items = response.data[objectPlural];

  return Array.isArray(items) ? items : [];
};

export const normalizeListResponse = (
  response: unknown,
  objectPlural: string,
): NormalizedListResponse => {
  const items = getItems(response, objectPlural);
  const responseRecord = isRecord(response) ? response : {};
  const pageInfo = isRecord(responseRecord.pageInfo)
    ? responseRecord.pageInfo
    : {};
  const hasMore =
    pageInfo.hasNextPage === true || pageInfo.hasPreviousPage === true;
  const nextCursor =
    typeof pageInfo.endCursor === 'string'
      ? pageInfo.endCursor
      : typeof pageInfo.startCursor === 'string'
        ? pageInfo.startCursor
        : null;

  return {
    total:
      typeof responseRecord.totalCount === 'number'
        ? responseRecord.totalCount
        : null,
    count: items.length,
    items,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
};
