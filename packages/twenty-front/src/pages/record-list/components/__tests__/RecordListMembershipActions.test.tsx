import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

import { RecordListMembershipActions } from '~/pages/record-list/components/RecordListMembershipActions';

const mockCreateManyRecords = jest.fn();
const mockDeleteManyRecords = jest.fn();
const mockFindSelectedMemberships = jest.fn();
const mockCloseDropdown = jest.fn();
const mockRefetchQueries = jest.fn();
const mockRequestRecordTableReload = jest.fn();
let mockSelectedRecords: Array<{ id: string }> = [];
const mockStoreGet = jest.fn(() => [
  {
    isSelected: true,
    objectMetadataId: 'company-object-metadata-id',
    recordId: 'company-id',
  },
]);

jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useStore: () => ({ get: mockStoreGet }),
}));

jest.mock('@/command-menu-item/hooks/useCurrentCommandMenuContextApi', () => ({
  useCurrentCommandMenuContextApi: () => ({
    selectedRecords: mockSelectedRecords,
  }),
}));

jest.mock('@/object-metadata/hooks/useApolloCoreClient', () => ({
  useApolloCoreClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({
    objectMetadataItem: { id: 'record-list-object-metadata-id' },
  }),
}));

jest.mock('@/object-record/hooks/useCreateManyRecords', () => ({
  useCreateManyRecords: () => ({ createManyRecords: mockCreateManyRecords }),
}));

jest.mock('@/object-record/hooks/useDeleteManyRecords', () => ({
  useDeleteManyRecords: () => ({ deleteManyRecords: mockDeleteManyRecords }),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: () => ({ records: [] }),
}));

jest.mock('@/object-record/hooks/useLazyFindManyRecords', () => ({
  useLazyFindManyRecords: () => ({
    findManyRecordsLazy: mockFindSelectedMemberships,
  }),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/object-record/record-index/contexts/RecordIndexContext', () => ({
  useRecordIndexContextOrThrow: () => ({ recordIndexId: 'record-index-id' }),
}));

jest.mock(
  '@/object-record/record-field/ui/form-types/hooks/useOpenFormMultiRecordPicker',
  () => ({
    useOpenFormMultiRecordPicker: () => ({
      openFormMultiRecordPicker: jest.fn(),
    }),
  }),
);

jest.mock(
  '@/object-record/record-picker/multiple-record-picker/components/MultipleRecordPicker',
  () => ({
    MultipleRecordPicker: ({
      onClickOutside,
      onSubmit,
      submitButtonTitle,
    }: {
      onClickOutside: () => void;
      onSubmit: () => void;
      submitButtonTitle?: string;
    }) => (
      <>
        <button type="button" onClick={onClickOutside}>
          Close picker
        </button>
        <button type="button" onClick={onSubmit}>
          {submitButtonTitle}
        </button>
      </>
    ),
  }),
);

jest.mock(
  '@/object-record/record-picker/multiple-record-picker/states/multipleRecordPickerPickableMorphItemsComponentState',
  () => ({
    multipleRecordPickerPickableMorphItemsComponentState: {
      atomFamily: jest.fn(),
    },
  }),
);

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueErrorSnackBar: jest.fn(),
    enqueueSuccessSnackBar: jest.fn(),
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

jest.mock('@/ui/layout/dropdown/hooks/useCloseDropdown', () => ({
  useCloseDropdown: () => ({ closeDropdown: mockCloseDropdown }),
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useSetAtomComponentState', () => ({
  useSetAtomComponentState: () => mockRequestRecordTableReload,
}));

describe('RecordListMembershipActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedRecords = [];
  });

  it('adds selected records when the picker closes', async () => {
    render(
      <RecordListMembershipActions
        recordListId="record-list-id"
        recordListType="COMPANY"
        targetObjectNameSingular="company"
        requiredFilter={{}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close picker' }));

    await waitFor(() => {
      expect(mockCreateManyRecords).toHaveBeenCalledWith({
        recordsToCreate: [
          {
            recordListId: 'record-list-id',
            targetCompanyId: 'company-id',
          },
        ],
        upsert: true,
      });
    });
    expect(mockCloseDropdown).toHaveBeenCalledWith(
      'record-list-add-records-record-list-id',
    );
    expect(mockRefetchQueries).toHaveBeenCalledWith({ include: 'active' });
    expect(mockRequestRecordTableReload).toHaveBeenCalledWith(
      expect.any(Function),
    );

    const incrementReloadRequestId =
      mockRequestRecordTableReload.mock.calls[0][0];

    expect(incrementReloadRequestId(4)).toBe(5);
  });

  it('adds selected records from the explicit picker action', async () => {
    render(
      <RecordListMembershipActions
        recordListId="record-list-id"
        recordListType="COMPANY"
        targetObjectNameSingular="company"
        requiredFilter={{}}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Add selected records' }),
    );

    await waitFor(() => {
      expect(mockCreateManyRecords).toHaveBeenCalledWith({
        recordsToCreate: [
          {
            recordListId: 'record-list-id',
            targetCompanyId: 'company-id',
          },
        ],
        upsert: true,
      });
    });
  });

  it('reloads the table after removing selected records', async () => {
    mockSelectedRecords = [{ id: 'company-id' }];
    mockFindSelectedMemberships.mockResolvedValue({
      records: [{ id: 'record-list-member-id' }],
    });

    render(
      <RecordListMembershipActions
        recordListId="record-list-id"
        recordListType="COMPANY"
        targetObjectNameSingular="company"
        requiredFilter={{}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Remove from list/ }));

    await waitFor(() => {
      expect(mockDeleteManyRecords).toHaveBeenCalledWith({
        recordIdsToDelete: ['record-list-member-id'],
        skipOptimisticEffect: true,
      });
    });
    expect(mockRefetchQueries).toHaveBeenCalledWith({ include: 'active' });
    expect(mockRequestRecordTableReload).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });
});
