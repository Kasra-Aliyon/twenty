import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppPath, RECORD_LIST_TYPES } from 'twenty-shared/types';

import { RecordListCreatePage } from '~/pages/record-list/RecordListCreatePage';

const mockCloseModal = jest.fn();
const mockCreateList = jest.fn();
const mockOpenModal = jest.fn();
const mockRefetchQueries = jest.fn();
const mockSetIsRecordListsPanelOpen = jest.fn();

jest.mock('@/object-metadata/hooks/useApolloCoreClient', () => ({
  useApolloCoreClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock('@/object-record/hooks/useCreateOneRecord', () => ({
  useCreateOneRecord: () => ({
    createOneRecord: mockCreateList,
    loading: false,
  }),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: ({
    objectNameSingular,
  }: {
    objectNameSingular: string;
  }) =>
    objectNameSingular === 'recordListFolder'
      ? {
          records: [
            {
              __typename: 'RecordListFolder',
              id: 'folder-id',
              name: 'Pipeline',
              position: 0,
            },
          ],
        }
      : {
          records: [
            {
              __typename: 'RecordList',
              id: 'existing-list-id',
              folderId: 'folder-id',
              position: 5,
            },
          ],
        },
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));

jest.mock('@/ui/layout/modal/components/ModalStatefulWrapper', () => ({
  ModalStatefulWrapper: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

jest.mock('@/ui/layout/modal/hooks/useModal', () => ({
  useModal: () => ({
    closeModal: mockCloseModal,
    openModal: mockOpenModal,
  }),
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useSetAtomState', () => ({
  useSetAtomState: () => mockSetIsRecordListsPanelOpen,
}));

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

describe('RecordListCreatePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateList.mockResolvedValue({ id: 'created-list-id' });
  });

  it('creates a list in the selected folder from a modal', async () => {
    render(
      <MemoryRouter
        initialEntries={[AppPath.RecordListCreatePage]}
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <Routes>
          <Route
            path={AppPath.RecordListCreatePage}
            element={<RecordListCreatePage />}
          />
          <Route
            path={AppPath.RecordListPage}
            element={<div>Created list</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockOpenModal).toHaveBeenCalledWith('record-list-create-modal');

    fireEvent.change(screen.getByRole('textbox', { name: 'List name' }), {
      target: { value: 'My people' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'People' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'List folder' }), {
      target: { value: 'folder-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Create list/ }));

    await waitFor(() => {
      expect(mockCreateList).toHaveBeenCalledWith({
        folderId: 'folder-id',
        name: 'My people',
        position: 6,
        type: RECORD_LIST_TYPES.PERSON,
      });
    });
    expect(mockRefetchQueries).toHaveBeenCalledWith({ include: 'active' });
    expect(mockSetIsRecordListsPanelOpen).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText('Created list')).toBeInTheDocument();
  });
});
