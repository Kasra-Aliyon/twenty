import {
  combineFilters,
  filterCondition,
  textSearchFilter,
} from '../filter-builder.js';
import { normalizeListResponse } from '../pagination.js';

describe('REST pagination normalization', () => {
  it('normalizes records and forward cursor metadata', () => {
    expect(
      normalizeListResponse(
        {
          data: { people: [{ id: 'person-1' }, { id: 'person-2' }] },
          totalCount: 12,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            endCursor: 'cursor-2',
          },
        },
        'people',
      ),
    ).toEqual({
      total: 12,
      count: 2,
      items: [{ id: 'person-1' }, { id: 'person-2' }],
      has_more: true,
      next_cursor: 'cursor-2',
    });
  });

  it('returns an empty normalized result for malformed responses', () => {
    expect(normalizeListResponse(null, 'people')).toEqual({
      total: null,
      count: 0,
      items: [],
      has_more: false,
      next_cursor: null,
    });
  });
});

describe('REST filter builders', () => {
  it('quotes string values and combines only defined filters', () => {
    const stageFilter = filterCondition('stage', 'eq', 'PROPOSAL');
    const amountFilter = filterCondition(
      'amount.amountMicros',
      'gt',
      1_000_000,
    );

    expect(stageFilter).toBe('stage[eq]:"PROPOSAL"');
    expect(combineFilters('and', [stageFilter, undefined, amountFilter])).toBe(
      'and(stage[eq]:"PROPOSAL",amount.amountMicros[gt]:1000000)',
    );
  });

  it('builds a multi-field text search after trimming input', () => {
    expect(textSearchFilter(['name', 'domainName'], '  Acme  ')).toBe(
      'or(name[ilike]:"%Acme%",domainName[ilike]:"%Acme%")',
    );
    expect(textSearchFilter(['name'], ' ')).toBeUndefined();
  });
});
