import { t } from '@lingui/core/macro';
import { generatePath } from 'react-router-dom';
import { AppPath, RECORD_LIST_TYPES } from 'twenty-shared/types';
import {
  IconBuildingSkyscraper,
  IconChevronDown,
  IconChevronUp,
  IconFolder,
  IconPencil,
  IconTargetArrow,
  IconTrash,
  IconUser,
} from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';

import { ROOT_RECORD_LIST_FOLDER_ID } from '../constants/record-list-folder.constants';
import {
  type EditingRecordListItem,
  type RecordListFolderRecord,
  type RecordListRecord,
} from '../types/RecordListRecords';
import {
  StyledActions,
  StyledFolder,
  StyledFolderCount,
  StyledFolderHeader,
  StyledFolderIcon,
  StyledFolderTitle,
  StyledListIcon,
  StyledListLink,
  StyledListRow,
  StyledSelect,
} from './RecordListsPageStyles';

const LIST_ICON_BY_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: IconBuildingSkyscraper,
  [RECORD_LIST_TYPES.PERSON]: IconUser,
  [RECORD_LIST_TYPES.OPPORTUNITY]: IconTargetArrow,
} as const;

export const RecordListFolderSection = ({
  folder,
  folderIndex,
  folderCount,
  lists,
  folders,
  listCountByFolderId,
  nextListPositionByFolderId,
  canManageLists,
  isReorderingDisabled,
  isSaving,
  onUpdateFolderPosition,
  onDeleteFolder,
  onUpdateList,
  onDeleteList,
  onStartRename,
}: {
  folder: RecordListFolderRecord | null;
  folderIndex: number;
  folderCount: number;
  lists: RecordListRecord[];
  folders: RecordListFolderRecord[];
  listCountByFolderId: Record<string, number>;
  nextListPositionByFolderId: Record<string, number>;
  canManageLists: boolean;
  isReorderingDisabled: boolean;
  isSaving: boolean;
  onUpdateFolderPosition: (folderId: string, position: number) => void;
  onDeleteFolder: (folderId: string) => void;
  onUpdateList: (
    listId: string,
    input: { position?: number; folderId?: string | null },
  ) => void;
  onDeleteList: (listId: string) => void;
  onStartRename: (item: EditingRecordListItem) => void;
}) => (
  <StyledFolder>
    {folder && (
      <StyledFolderHeader>
        <StyledFolderTitle>
          <StyledFolderIcon>
            <IconFolder size={16} />
          </StyledFolderIcon>
          <span>{folder.name}</span>
          <StyledFolderCount>{lists.length}</StyledFolderCount>
        </StyledFolderTitle>
        {canManageLists && (
          <StyledActions data-record-list-actions>
            <Button
              ariaLabel={t`Move folder up`}
              Icon={IconChevronUp}
              variant="tertiary"
              size="small"
              disabled={folderIndex === 0 || isReorderingDisabled || isSaving}
              onClick={() =>
                onUpdateFolderPosition(
                  folder.id,
                  folderIndex === 1
                    ? folders[0].position - 1
                    : (folders[folderIndex - 2].position +
                        folders[folderIndex - 1].position) /
                        2,
                )
              }
            />
            <Button
              ariaLabel={t`Move folder down`}
              Icon={IconChevronDown}
              variant="tertiary"
              size="small"
              disabled={
                folderIndex === folderCount - 1 ||
                isReorderingDisabled ||
                isSaving
              }
              onClick={() =>
                onUpdateFolderPosition(
                  folder.id,
                  folderIndex === folderCount - 2
                    ? folders[folderIndex + 1].position + 1
                    : (folders[folderIndex + 1].position +
                        folders[folderIndex + 2].position) /
                        2,
                )
              }
            />
            <Button
              ariaLabel={t`Rename folder`}
              Icon={IconPencil}
              variant="tertiary"
              size="small"
              onClick={() =>
                onStartRename({
                  kind: 'folder',
                  id: folder.id,
                  name: folder.name,
                })
              }
            />
            <Button
              ariaLabel={t`Delete folder`}
              Icon={IconTrash}
              variant="tertiary"
              accent="danger"
              size="small"
              disabled={(listCountByFolderId[folder.id] ?? 0) > 0 || isSaving}
              onClick={() => onDeleteFolder(folder.id)}
            />
          </StyledActions>
        )}
      </StyledFolderHeader>
    )}
    {lists.map((recordList, listIndex) => {
      const ListIcon = LIST_ICON_BY_TYPE[recordList.type];

      return (
        <StyledListRow key={recordList.id}>
          <StyledListLink
            to={generatePath(AppPath.RecordListPage, {
              recordListId: recordList.id,
            })}
          >
            <StyledListIcon>
              <ListIcon size={16} />
            </StyledListIcon>
            <span>{recordList.name}</span>
          </StyledListLink>
          {canManageLists && (
            <StyledActions data-record-list-actions>
              <Button
                ariaLabel={t`Move list up`}
                Icon={IconChevronUp}
                variant="tertiary"
                size="small"
                disabled={listIndex === 0 || isReorderingDisabled || isSaving}
                onClick={() =>
                  onUpdateList(recordList.id, {
                    position:
                      listIndex === 1
                        ? lists[0].position - 1
                        : (lists[listIndex - 2].position +
                            lists[listIndex - 1].position) /
                          2,
                  })
                }
              />
              <Button
                ariaLabel={t`Move list down`}
                Icon={IconChevronDown}
                variant="tertiary"
                size="small"
                disabled={
                  listIndex === lists.length - 1 ||
                  isReorderingDisabled ||
                  isSaving
                }
                onClick={() =>
                  onUpdateList(recordList.id, {
                    position:
                      listIndex === lists.length - 2
                        ? lists[listIndex + 1].position + 1
                        : (lists[listIndex + 1].position +
                            lists[listIndex + 2].position) /
                          2,
                  })
                }
              />
              <StyledSelect
                value={recordList.folderId ?? ROOT_RECORD_LIST_FOLDER_ID}
                aria-label={t`Move list to folder`}
                onChange={(event) =>
                  onUpdateList(recordList.id, {
                    folderId: event.target.value || null,
                    position:
                      nextListPositionByFolderId[event.target.value] ?? 0,
                  })
                }
              >
                <option
                  value={ROOT_RECORD_LIST_FOLDER_ID}
                >{t`No folder`}</option>
                {folders.map((folderOption) => (
                  <option key={folderOption.id} value={folderOption.id}>
                    {folderOption.name}
                  </option>
                ))}
              </StyledSelect>
              <Button
                ariaLabel={t`Rename list`}
                Icon={IconPencil}
                variant="tertiary"
                size="small"
                onClick={() =>
                  onStartRename({
                    kind: 'list',
                    id: recordList.id,
                    name: recordList.name,
                  })
                }
              />
              <Button
                ariaLabel={t`Delete list`}
                Icon={IconTrash}
                variant="tertiary"
                accent="danger"
                size="small"
                disabled={isSaving}
                onClick={() => onDeleteList(recordList.id)}
              />
            </StyledActions>
          )}
        </StyledListRow>
      );
    })}
  </StyledFolder>
);
