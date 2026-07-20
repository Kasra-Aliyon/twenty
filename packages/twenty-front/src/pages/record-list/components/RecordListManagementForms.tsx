import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { RECORD_LIST_TYPES, type RecordListType } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';

import { type RecordListFolderRecord } from '../types/RecordListRecords';
import { StyledForm, StyledInput, StyledSelect } from './RecordListsPageStyles';

export const RecordListManagementForms = ({
  folders,
  nextListPositionByFolderId,
  isSaving,
  onCreateFolder,
  onCreateList,
}: {
  folders: RecordListFolderRecord[];
  nextListPositionByFolderId: Record<string, number>;
  isSaving: boolean;
  onCreateFolder: (name: string) => void;
  onCreateList: (input: {
    name: string;
    type: RecordListType;
    folderId: string;
    position: number;
  }) => void;
}) => {
  const [newFolderName, setNewFolderName] = useState('');
  const [newListName, setNewListName] = useState('');
  const [newListType, setNewListType] = useState<RecordListType>(
    RECORD_LIST_TYPES.COMPANY,
  );
  const [newListFolderId, setNewListFolderId] = useState('');

  return (
    <>
      <StyledForm
        onSubmit={(event) => {
          event.preventDefault();
          onCreateFolder(newFolderName);
          setNewFolderName('');
        }}
      >
        <StyledInput
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
          placeholder={t`New folder name`}
          aria-label={t`New folder name`}
          required
        />
        <Button
          title={t`Create folder`}
          type="submit"
          variant="secondary"
          disabled={isSaving}
        />
      </StyledForm>
      <StyledForm
        onSubmit={(event) => {
          event.preventDefault();
          onCreateList({
            name: newListName,
            type: newListType,
            folderId: newListFolderId,
            position: nextListPositionByFolderId[newListFolderId] ?? 0,
          });
          setNewListName('');
        }}
      >
        <StyledInput
          value={newListName}
          onChange={(event) => setNewListName(event.target.value)}
          placeholder={t`New list name`}
          aria-label={t`New list name`}
          required
        />
        <StyledSelect
          value={newListType}
          onChange={(event) =>
            setNewListType(event.target.value as RecordListType)
          }
          aria-label={t`List type`}
        >
          <option value={RECORD_LIST_TYPES.COMPANY}>{t`Companies`}</option>
          <option value={RECORD_LIST_TYPES.PERSON}>{t`People`}</option>
          <option value={RECORD_LIST_TYPES.OPPORTUNITY}>
            {t`Opportunities`}
          </option>
        </StyledSelect>
        <StyledSelect
          value={newListFolderId}
          onChange={(event) => setNewListFolderId(event.target.value)}
          aria-label={t`List folder`}
          required
        >
          <option value="" disabled>
            {t`Select folder`}
          </option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </StyledSelect>
        <Button
          title={t`Create list`}
          type="submit"
          disabled={isSaving || folders.length === 0}
        />
      </StyledForm>
    </>
  );
};
