import { render } from '@testing-library/react';

import { AddToRecordListAction } from '@/record-list/components/AddToRecordListAction';

const mockUseObjectMetadataItem = jest.fn();

jest.mock('@/object-metadata/hooks/useDoObjectMetadataItemsExist', () => ({
  useDoObjectMetadataItemsExist: () => false,
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: (...args: unknown[]) =>
    mockUseObjectMetadataItem(...args),
}));

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

describe('AddToRecordListAction', () => {
  it.each(['company', 'person', 'opportunity'])(
    'does not resolve record-list metadata for %s when it is not installed',
    (objectNameSingular) => {
      render(<AddToRecordListAction objectNameSingular={objectNameSingular} />);

      expect(mockUseObjectMetadataItem).not.toHaveBeenCalled();
    },
  );
});
