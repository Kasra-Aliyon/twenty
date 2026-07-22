import { renderHook } from '@testing-library/react';

import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';

const mockUseAtomFamilySelectorValue = jest.fn();

jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue',
  () => ({
    useAtomFamilySelectorValue: () => mockUseAtomFamilySelectorValue(),
  }),
);

describe('useDoObjectMetadataItemsExist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false when requested metadata is missing', () => {
    mockUseAtomFamilySelectorValue.mockReturnValue([]);

    const { result } = renderHook(() =>
      useDoObjectMetadataItemsExist(['messageDraft']),
    );

    expect(result.current).toBe(false);
  });

  it('returns true when every requested metadata item is present', () => {
    mockUseAtomFamilySelectorValue.mockReturnValue([
      { nameSingular: 'messageDraft' },
      { nameSingular: 'messageThread' },
    ]);

    const { result } = renderHook(() =>
      useDoObjectMetadataItemsExist(['messageDraft', 'messageThread']),
    );

    expect(result.current).toBe(true);
  });
});
