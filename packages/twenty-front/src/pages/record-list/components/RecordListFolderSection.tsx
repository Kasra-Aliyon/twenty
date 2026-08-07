import { pointerIntersection } from '@dnd-kit/collision';
import { useDroppable } from '@dnd-kit/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { generatePath } from 'react-router-dom';
import { AppPath, RECORD_LIST_TYPES } from 'twenty-shared/types';
import {
  IconBuildingSkyscraper,
  IconChevronDown,
  IconChevronRight,
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
  StyledFolderToggleIcon,
  StyledListIcon,
  StyledListLink,
  StyledListRow,
} from './RecordListsPageStyles';
import { RECORD_LIST_DRAG_DROP } from '../constants/record-list-drag-drop.constants';
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
  memberCountByListId: Record<string, number>;
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
  memberCountByListId,
  newFolderDraft,
  onChangeNewFolderDraft,
  onDeleteFolder,
  onDeleteList,
  onPinFolder,
  onPinList,
  onSaveNewFolderName,
  onSelectList,
  onStartRename,
}: RecordListFolderSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const { isDropTarget, ref: folderDropTargetRef } = useDroppable({
    id: `${RECORD_LIST_DRAG_DROP.folderDropTargetIdPrefix}${folder?.id ?? 'root'}`,
    collisionDetector: pointerIntersection,
    collisionPriority: 10,
    data: {
      folderId: folder?.id ?? '',
      kind: RECORD_LIST_DRAG_DROP.folderDropTargetKind,
    },
    disabled:
      folder === null || !canManageLists || isReorderingDisabled || isSaving,
  });

  const toggleFolder = () => setIsExpanded((isOpen) => !isOpen);
  const folderMemberCount = lists.reduce(
    (count, recordList) => count + (memberCountByListId[recordList.id] ?? 0),
    0,
  );

  return (
    <StyledFolder>
      {folder && (
        <StyledFolderHeader
          ref={folderDropTargetRef}
          $isDropTarget={isDropTarget}
        >
          <StyledFolderTitle
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            onClick={toggleFolder}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleFolder();
              }
            }}
          >
            <StyledFolderToggleIcon>
              {isExpanded ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </StyledFolderToggleIcon>
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
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onBlur={(event) =>
                  onSaveNewFolderName(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  event.stopPropagation();
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
            <StyledFolderCount>{folderMemberCount}</StyledFolderCount>
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
      {(folder === null || isExpanded) &&
        lists.map((recordList, listIndex) => {
          const ListIcon = LIST_ICON_BY_TYPE[recordList.type];

          return (
            <RecordListSortableItem
              key={recordList.id}
              id={`${RECORD_LIST_DRAG_DROP.draggableIdPrefix}${recordList.id}`}
              index={listIndex}
              group={listSortableGroup}
              disabled={!canManageLists || isReorderingDisabled || isSaving}
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
                  <StyledFolderCount>
                    {memberCountByListId[recordList.id] ?? 0}
                  </StyledFolderCount>
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
};
