import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

import { AddToRecordListAction } from '@/record-list/components/AddToRecordListAction';

const mockUseObjectMetadataItem = jest.fn();
const mockUseDoObjectMetadataItemsExist = jest.fn(() => false);
const mockCreateManyRecords = jest.fn();
const mockEvict = jest.fn();
const mockRefetchQueries = jest.fn(
  ({
    updateCache,
  }: {
    updateCache?: (cache: { evict: typeof mockEvict }) => void;
  }) => updateCache?.({ evict: mockEvict }),
);
const mockUseFindManyRecords = jest.fn((_options?: unknown) => ({
  records: [
    {
      id: 'record-list-id',
      name: 'Top-level list',
      type: 'PERSON',
      folderId: null,
      folder: null,
    },
  ],
}));

jest.mock('@/object-metadata/hooks/useDoObjectMetadataItemsExist', () => ({
  useDoObjectMetadataItemsExist: () => mockUseDoObjectMetadataItemsExist(),
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: (...args: unknown[]) =>
    mockUseObjectMetadataItem(...args),
}));

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

jest.mock('@/command-menu-item/hooks/useCurrentCommandMenuContextApi', () => ({
  useCurrentCommandMenuContextApi: () => ({
    selectedRecords: [{ id: 'person-id' }],
  }),
}));

jest.mock('@/object-metadata/hooks/useApolloCoreClient', () => ({
  useApolloCoreClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock('@/object-record/hooks/useCreateManyRecords', () => ({
  useCreateManyRecords: () => ({ createManyRecords: mockCreateManyRecords }),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: (options: unknown) => mockUseFindManyRecords(options),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: jest.fn(),
  }),
}));

jest.mock('@/ui/layout/dropdown/components/Dropdown', () => ({
  Dropdown: ({
    clickableComponent,
    dropdownComponents,
  }: {
    clickableComponent: ReactNode;
    dropdownComponents: ReactNode;
  }) => (
    <>
      {clickableComponent}
      {dropdownComponents}
    </>
  ),
}));

jest.mock('@/ui/layout/dropdown/components/DropdownContent', () => ({
  DropdownContent: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/ui/layout/dropdown/components/DropdownMenuItemsContainer', () => ({
  DropdownMenuItemsContainer: ({ children }: { children: ReactNode }) =>
    children,
}));

jest.mock('@/ui/layout/dropdown/components/DropdownMenuSectionLabel', () => ({
  DropdownMenuSectionLabel: ({ label }: { label: string }) => <>{label}</>,
}));

jest.mock('twenty-ui/navigation', () => ({
  MenuItem: ({
    text,
    onClick,
    disabled,
  }: {
    text: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {text}
    </button>
  ),
}));

jest.mock('@/ui/layout/dropdown/hooks/useCloseDropdown', () => ({
  useCloseDropdown: () => ({ closeDropdown: jest.fn() }),
}));

describe('AddToRecordListAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDoObjectMetadataItemsExist.mockReturnValue(false);
  });

  it.each(['company', 'person', 'opportunity'])(
    'does not resolve record-list metadata for %s when it is not installed',
    (objectNameSingular) => {
      render(<AddToRecordListAction objectNameSingular={objectNameSingular} />);

      expect(mockUseObjectMetadataItem).not.toHaveBeenCalled();
    },
  );

  it('renders when a compatible record list has no folder', () => {
    mockUseDoObjectMetadataItemsExist.mockReturnValue(true);
    mockUseObjectMetadataItem.mockReturnValue({
      objectMetadataItem: { id: 'record-list-object-metadata-id' },
    });

    expect(() =>
      render(<AddToRecordListAction objectNameSingular="person" />),
    ).not.toThrow();
  });

  it.each([
    ['company', 'companies', 'COMPANY', 'targetCompanyId'],
    ['person', 'people', 'PERSON', 'targetPersonId'],
    ['opportunity', 'opportunities', 'OPPORTUNITY', 'targetOpportunityId'],
  ])(
    'adds selected %s records to a compatible list',
    async (
      objectNameSingular,
      objectNamePlural,
      recordListType,
      targetFieldName,
    ) => {
      mockUseDoObjectMetadataItemsExist.mockReturnValue(true);
      mockUseObjectMetadataItem.mockImplementation(
        ({ objectNameSingular: requestedObjectNameSingular }) => ({
          objectMetadataItem:
            requestedObjectNameSingular === 'recordList'
              ? { id: 'record-list-object-metadata-id' }
              : { namePlural: objectNamePlural },
        }),
      );

      render(<AddToRecordListAction objectNameSingular={objectNameSingular} />);

      fireEvent.click(screen.getByRole('button', { name: 'Top-level list' }));

      await waitFor(() => {
        expect(mockCreateManyRecords).toHaveBeenCalledWith({
          recordsToCreate: [
            {
              recordListId: 'record-list-id',
              [targetFieldName]: 'person-id',
            },
          ],
          upsert: true,
        });
        expect(mockEvict).toHaveBeenCalledWith({
          fieldName: objectNamePlural,
        });
      });
      expect(mockUseFindManyRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { type: { eq: recordListType } },
        }),
      );
    },
  );
});
