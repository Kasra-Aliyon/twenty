import { type RecordGqlOperationFilter } from 'twenty-shared/types';
import { combineFilters } from 'twenty-shared/utils';

describe('combineFilters', () => {
  it('should return empty object when all filters are empty', () => {
    const result = combineFilters([{}, {}, {}]);
    expect(result).toEqual({});
  });

  it('should return the single non-empty filter directly', () => {
    const filter: RecordGqlOperationFilter = { field1: { eq: 'Test' } };
    const result = combineFilters([{}, filter, {}]);
    expect(result).toEqual(filter);
  });

  it('should combine multiple non-empty filters with AND logic', () => {
    const filter1: RecordGqlOperationFilter = { field1: { eq: 'Test' } };
    const filter2: RecordGqlOperationFilter = { field2: { eq: 'Active' } };
    const result = combineFilters([filter1, filter2]);
    expect(result).toEqual({
      and: [filter1, filter2],
    });
  });

  it('should handle an empty array by returning an empty object', () => {
    const result = combineFilters([]);
    expect(result).toEqual({});
  });

  it('keeps an immutable relation base filter alongside presentation filters', () => {
    const presentationFilter: RecordGqlOperationFilter = {
      name: { ilike: '%Acme%' },
    };
    const requiredFilter: RecordGqlOperationFilter = {
      recordListMemberships: {
        recordListId: { eq: 'record-list-id' },
      },
    };

    expect(
      combineFilters([undefined, presentationFilter, requiredFilter]),
    ).toEqual({ and: [presentationFilter, requiredFilter] });
  });
});
