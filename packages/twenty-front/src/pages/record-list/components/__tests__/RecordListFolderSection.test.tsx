import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { RECORD_LIST_TYPES } from 'twenty-shared/types';

import { RecordListFolderSection } from '~/pages/record-list/components/RecordListFolderSection';
import {
  type EditingRecordListItem,
  type RecordListFolderRecord,
  type RecordListRecord,
} from '~/pages/record-list/types/RecordListRecords';

const mockSaveNewFolderName = jest.fn();
const mockSelectList = jest.fn();

jest.mock(
  '~/pages/record-list/components/RecordListItemActionsDropdown',
  () => ({ RecordListItemActionsDropdown: () => null }),
);

jest.mock('~/pages/record-list/components/RecordListSortableItem', () => ({
  RecordListSortableItem: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const folder = {
  __typename: 'RecordListFolder',
  id: 'folder-id',
  name: 'Untitled',
  position: 0,
} as RecordListFolderRecord;

const recordList = {
  __typename: 'RecordList',
  id: 'list-id',
  name: 'Customers',
  type: RECORD_LIST_TYPES.COMPANY,
  position: 0,
  folderId: folder.id,
  folder,
} as RecordListRecord;

const TestRecordListFolderSection = ({
  newFolderDraft,
  onChangeNewFolderDraft,
  onSaveNewFolderName,
  onSelectList,
}: {
  newFolderDraft: EditingRecordListItem | null;
  onChangeNewFolderDraft: (item: EditingRecordListItem) => void;
  onSaveNewFolderName: (name: string) => void;
  onSelectList?: () => void;
}) => (
  <RecordListFolderSection
    canManageLists
    folder={folder}
    isReorderingDisabled={false}
    isSaving={false}
    listSortableGroup="record-lists:folder-id"
    lists={[recordList]}
    newFolderDraft={newFolderDraft}
    onChangeNewFolderDraft={onChangeNewFolderDraft}
    onDeleteFolder={jest.fn()}
    onDeleteList={jest.fn()}
    onPinFolder={jest.fn()}
    onPinList={jest.fn()}
    onSaveNewFolderName={onSaveNewFolderName}
    onSelectList={onSelectList}
    onStartRename={jest.fn()}
  />
);

const NewFolderNameHarness = () => {
  const [newFolderDraft, setNewFolderDraft] = useState<EditingRecordListItem>({
    kind: 'folder',
    id: folder.id,
    name: 'Untitled',
  });

  return (
    <MemoryRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <TestRecordListFolderSection
        newFolderDraft={newFolderDraft}
        onChangeNewFolderDraft={setNewFolderDraft}
        onSaveNewFolderName={mockSaveNewFolderName}
      />
    </MemoryRouter>
  );
};

describe('RecordListFolderSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('edits a newly created folder name inline and saves it on Enter', () => {
    render(<NewFolderNameHarness />);

    const folderNameInput = screen.getByRole('textbox', {
      name: 'Folder name',
    });

    expect(folderNameInput).toHaveFocus();

    fireEvent.change(folderNameInput, { target: { value: 'Prospects' } });
    fireEvent.keyDown(folderNameInput, { key: 'Enter' });

    expect(mockSaveNewFolderName).toHaveBeenCalledTimes(1);
    expect(mockSaveNewFolderName).toHaveBeenCalledWith('Prospects');
  });

  it('notifies the panel when a list is selected', () => {
    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <TestRecordListFolderSection
          newFolderDraft={null}
          onChangeNewFolderDraft={jest.fn()}
          onSaveNewFolderName={jest.fn()}
          onSelectList={mockSelectList}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Customers' }));

    expect(mockSelectList).toHaveBeenCalledTimes(1);
  });
});
