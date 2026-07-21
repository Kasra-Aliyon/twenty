import { t } from '@lingui/core/macro';
import { generatePath } from 'react-router-dom';
import { AppPath, RECORD_LIST_TYPES } from 'twenty-shared/types';
import {
  IconBuildingSkyscraper,
  IconFolder,
  IconTargetArrow,
  IconUser,
} from 'twenty-ui/icon';

import { RecordListItemActionsDropdown } from './RecordListItemActionsDropdown';
import { RecordListSortableItem } from './RecordListSortableItem';
import {
  StyledActions,
  StyledFolder,
  StyledFolderCount,
  StyledFolderHeader,
  StyledFolderIcon,
  StyledFolderNameInput,
  StyledFolderTitle,
  StyledListIcon,
  StyledListLink,
  StyledListRow,
} from './RecordListsPageStyles';
import {
  type EditingRecordListItem,
  type RecordListFolderRecord,
  type RecordListRecord,
} from '../types/RecordListRecords';

const LIST_ICON_BY_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: IconBuildingSkyscraper,
  [RECORD_LIST_TYPES.PERSON]: IconUser,
  [RECORD_LIST_TYPES.OPPORTUNITY]: IconTargetArrow,
} as const;

type RecordListFolderSectionProps = {
  canManageLists: boolean;
  folder: RecordListFolderRecord | null;
  isFolderDeleteDisabled?: boolean;
  isFolderPinDisabled?: boolean;
  isReorderingDisabled: boolean;
  isSaving: boolean;
  listSortableGroup: string;
  lists: RecordListRecord[];
  newFolderDraft: EditingRecordListItem | null;
  onChangeNewFolderDraft: (item: EditingRecordListItem) => void;
  onDeleteFolder: (folderId: string) => void;
  onDeleteList: (listId: string) => void;
  onPinFolder: (folderId: string) => void;
  onPinList: (listId: string) => void;
  onSaveNewFolderName: (name: string) => void;
  onSelectList?: () => void;
  onStartRename: (item: EditingRecordListItem) => void;
};

export const RecordListFolderSection = ({
  canManageLists,
  folder,
  isFolderDeleteDisabled = false,
  isFolderPinDisabled = false,
  isReorderingDisabled,
  isSaving,
  listSortableGroup,
  lists,
  newFolderDraft,
  onChangeNewFolderDraft,
  onDeleteFolder,
  onDeleteList,
  onPinFolder,
  onPinList,
  onSaveNewFolderName,
  onSelectList,
  onStartRename,
}: RecordListFolderSectionProps) => (
  <StyledFolder>
    {folder && (
      <StyledFolderHeader>
        <StyledFolderTitle>
          <StyledFolderIcon>
            <IconFolder size={16} />
          </StyledFolderIcon>
          {newFolderDraft?.id === folder.id ? (
            <StyledFolderNameInput
              autoFocus
              value={newFolderDraft.name}
              onChange={(event) =>
                onChangeNewFolderDraft({
                  ...newFolderDraft,
                  name: event.target.value,
                })
              }
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => onSaveNewFolderName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              aria-label={t`Folder name`}
            />
          ) : (
            <span>{folder.name}</span>
          )}
          <StyledFolderCount>{lists.length}</StyledFolderCount>
        </StyledFolderTitle>
        {canManageLists && (
          <StyledActions data-record-list-actions>
            <RecordListItemActionsDropdown
              itemId={folder.id}
              itemKind="folder"
              isPinDisabled={
                isFolderPinDisabled || isReorderingDisabled || isSaving
              }
              isDeleteDisabled={isFolderDeleteDisabled || isSaving}
              onPin={() => onPinFolder(folder.id)}
              onRename={() =>
                onStartRename({
                  kind: 'folder',
                  id: folder.id,
                  name: folder.name,
                })
              }
              onDelete={() => onDeleteFolder(folder.id)}
            />
          </StyledActions>
        )}
      </StyledFolderHeader>
    )}
    {lists.map((recordList, listIndex) => {
      const ListIcon = LIST_ICON_BY_TYPE[recordList.type];

      return (
        <RecordListSortableItem
          key={recordList.id}
          id={`record-list:${recordList.id}`}
          index={listIndex}
          group={listSortableGroup}
          disabled={
            !canManageLists ||
            isReorderingDisabled ||
            isSaving ||
            lists.length === 1
          }
        >
          <StyledListRow>
            <StyledListLink
              to={generatePath(AppPath.RecordListPage, {
                recordListId: recordList.id,
              })}
              onClick={onSelectList}
            >
              <StyledListIcon>
                <ListIcon size={16} />
              </StyledListIcon>
              <span>{recordList.name}</span>
            </StyledListLink>
            {canManageLists && (
              <StyledActions data-record-list-actions>
                <RecordListItemActionsDropdown
                  itemId={recordList.id}
                  itemKind="list"
                  isPinDisabled={
                    listIndex === 0 || isReorderingDisabled || isSaving
                  }
                  isDeleteDisabled={isSaving}
                  onPin={() => onPinList(recordList.id)}
                  onRename={() =>
                    onStartRename({
                      kind: 'list',
                      id: recordList.id,
                      name: recordList.name,
                    })
                  }
                  onDelete={() => onDeleteList(recordList.id)}
                />
              </StyledActions>
            )}
          </StyledListRow>
        </RecordListSortableItem>
      );
    })}
  </StyledFolder>
);
