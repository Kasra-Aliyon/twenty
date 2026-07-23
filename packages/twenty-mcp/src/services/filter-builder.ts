export type FilterComparator =
  | 'containsAny'
  | 'endsWith'
  | 'eq'
  | 'gt'
  | 'gte'
  | 'ilike'
  | 'in'
  | 'is'
  | 'like'
  | 'lt'
  | 'lte'
  | 'neq'
  | 'startsWith';

const formatFilterValue = (value: unknown): string => {
  if (value === null) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  return JSON.stringify(value);
};

export const filterCondition = (
  field: string,
  comparator: FilterComparator,
  value: unknown,
): string => `${field}[${comparator}]:${formatFilterValue(value)}`;

export const combineFilters = (
  conjunction: 'and' | 'or',
  filters: Array<string | undefined>,
): string | undefined => {
  const definedFilters = filters.filter(
    (filter): filter is string => filter !== undefined && filter !== '',
  );

  if (definedFilters.length === 0) {
    return undefined;
  }

  if (definedFilters.length === 1) {
    return definedFilters[0];
  }

  return `${conjunction}(${definedFilters.join(',')})`;
};

export const textSearchFilter = (
  fields: string[],
  search: string | undefined,
): string | undefined => {
  if (search === undefined || search.trim() === '') {
    return undefined;
  }

  return combineFilters(
    'or',
    fields.map((field) =>
      filterCondition(field, 'ilike', `%${search.trim()}%`),
    ),
  );
};
