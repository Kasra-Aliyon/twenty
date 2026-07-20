import { renderHook } from '@testing-library/react';

import { useCanPersistViewChanges } from '@/views/hooks/useCanPersistViewChanges';
import { ViewVisibility } from '~/generated-metadata/graphql';

const mockUseGetCurrentViewOnly = jest.fn();

jest.mock('@/object-metadata/hooks/useObjectMetadataItems', () => ({
  useObjectMetadataItems: () => ({ objectMetadataItems: [] }),
}));

jest.mock('@/object-record/hooks/useObjectPermissions', () => ({
  useObjectPermissions: () => ({ objectPermissionsByObjectMetadataId: {} }),
}));

jest.mock('@/settings/roles/hooks/useHasPermissionFlag', () => ({
  useHasPermissionFlag: () => true,
}));

jest.mock('@/views/hooks/useGetCurrentViewOnly', () => ({
  useGetCurrentViewOnly: () => mockUseGetCurrentViewOnly(),
}));

describe('useCanPersistViewChanges', () => {
  it('preserves regular view permissions when record-list metadata is absent', () => {
    mockUseGetCurrentViewOnly.mockReturnValue({
      currentView: {
        id: 'view-id',
        recordListId: null,
        visibility: ViewVisibility.WORKSPACE,
      },
    });

    const { result } = renderHook(() => useCanPersistViewChanges());

    expect(result.current.canPersistChanges).toBe(true);
  });

  it('does not allow list-view updates when record-list metadata is absent', () => {
    mockUseGetCurrentViewOnly.mockReturnValue({
      currentView: {
        id: 'view-id',
        recordListId: 'record-list-id',
        visibility: ViewVisibility.UNLISTED,
      },
    });

    const { result } = renderHook(() => useCanPersistViewChanges());

    expect(result.current.canPersistChanges).toBe(false);
  });
});
