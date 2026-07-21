import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissions } from '@/object-record/hooks/useObjectPermissions';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  AppPath,
  FeatureFlagKey,
  RECORD_LIST_TYPES,
} from 'twenty-shared/types';
import {
  IconFolder,
  IconLayoutGrid,
  IconSquarePlus,
  IconX,
} from 'twenty-ui/icon';
import { LightIconButton, SearchInput } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';
import { moveArrayItem } from '~/utils/array/moveArrayItem';

import { RecordListDragDropProvider } from './components/RecordListDragDropProvider';
import { RecordListFolderSection } from './components/RecordListFolderSection';
import { RecordListRenameForm } from './components/RecordListRenameForm';
import { RecordListSortableItem } from './components/RecordListSortableItem';
import {
  StyledContent,
  StyledEmptyState,
  StyledExplorerHeader,
  StyledExplorerTitle,
  StyledPanel,
  StyledSidePanel,
  StyledSidePanelHeader,
  StyledSidePanelTitle,
} from './components/RecordListsPageStyles';
import {
  getRecordListFolderKey,
  ROOT_RECORD_LIST_FOLDER_ID,
} from './constants/record-list-folder.constants';
import {
  type EditingRecordListItem,
  type RecordListFolderRecord,
  type RecordListRecord,
} from './types/RecordListRecords';
import { groupVisibleRecordLists } from './utils/groupVisibleRecordLists';

const OBJECT_NAME_BY_LIST_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: 'company',
  [RECORD_LIST_TYPES.PERSON]: 'person',
  [RECORD_LIST_TYPES.OPPORTUNITY]: 'opportunity',
} as const;

const RECORD_LISTS_CREATE_DROPDOWN_ID = 'record-lists-create-dropdown';
const RECORD_LIST_FOLDER_SORTABLE_GROUP = 'record-list-folders';
const RECORD_LIST_SORTABLE_GROUP_PREFIX = 'record-lists:';

const RecordLists = ({ onClose }: { onClose?: () => void }) => {
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<EditingRecordListItem | null>(
    null,
  );
  const [newFolderDraft, setNewFolderDraft] =
    useState<EditingRecordListItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isRecordListsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  );
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueErrorSnackBar } = useSnackBar();
  const { closeDropdown } = useCloseDropdown();
  const navigate = useNavigate();
  const { objectMetadataItem: recordListObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'recordList' });
  const recordListPermissions = useObjectPermissionsForObject(
    recordListObjectMetadataItem.id,
  );
  const canManageLists = recordListPermissions.canUpdateObjectRecords;
  const { createOneRecord: createFolder } =
    useCreateOneRecord<RecordListFolderRecord>({
      objectNameSingular: 'recordListFolder',
      skipPostOptimisticEffect: true,
    });
  const { updateOneRecord } = useUpdateOneRecord();
  const { deleteOneRecord: deleteFolder } = useDeleteOneRecord({
    objectNameSingular: 'recordListFolder',
  });
  const { deleteOneRecord: deleteList } = useDeleteOneRecord({
    objectNameSingular: 'recordList',
  });
  const { records: folders } = useFindManyRecords<RecordListFolderRecord>({
    objectNameSingular: 'recordListFolder',
    recordGqlFields: { id: true, name: true, position: true },
    orderBy: [{ position: 'AscNullsFirst' }],
    limit: QUERY_MAX_RECORDS,
    skip: !isRecordListsEnabled,
  });
  const { records: recordLists } = useFindManyRecords<RecordListRecord>({
    objectNameSingular: 'recordList',
    recordGqlFields: {
      id: true,
      name: true,
      type: true,
      position: true,
      folderId: true,
      folder: { id: true, name: true },
    },
    limit: QUERY_MAX_RECORDS,
    skip: !isRecordListsEnabled,
  });
  const { objectMetadataItems } = useObjectMetadataItems();
  const { objectPermissionsByObjectMetadataId } = useObjectPermissions();

  if (!isRecordListsEnabled) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  const runMutation = async (mutation: () => Promise<unknown>) => {
    setIsSaving(true);

    try {
      await mutation();
      await apolloCoreClient.refetchQueries({ include: 'active' });
    } catch {
      enqueueErrorSnackBar({ message: t`The list change could not be saved.` });
    } finally {
      setIsSaving(false);
    }
  };

  const canReadListType = (recordListType: RecordListRecord['type']) => {
    const targetObject = objectMetadataItems.find(
      (item) => item.nameSingular === OBJECT_NAME_BY_LIST_TYPE[recordListType],
    );

    return targetObject
      ? objectPermissionsByObjectMetadataId[targetObject.id]
          ?.canReadObjectRecords === true
      : false;
  };
  const listsByFolderId = groupVisibleRecordLists({
    recordLists,
    search,
    canReadListType,
  });
  const listCountByFolderId = recordLists.reduce<Record<string, number>>(
    (counts, recordList) => {
      const folderKey = getRecordListFolderKey(recordList.folderId);

      return {
        ...counts,
        [folderKey]: (counts[folderKey] ?? 0) + 1,
      };
    },
    {},
  );
  const sortedFolders = folders
    .slice()
    .sort((first, second) => first.position - second.position);
  const isSearching = search.trim().length > 0;
  const displayedFolders = sortedFolders.filter(
    (folder) =>
      (listsByFolderId[folder.id]?.length ?? 0) > 0 ||
      (canManageLists && !isSearching),
  );
  const topLevelLists = (listsByFolderId[ROOT_RECORD_LIST_FOLDER_ID] ?? [])
    .slice()
    .sort((first, second) => first.position - second.position);
  const nextFolderPosition = folders.reduce(
    (position, folder) => Math.max(position, folder.position + 1),
    0,
  );
  const shouldShowListActions = canManageLists;

  const saveRename = async () => {
    if (!editingItem) return;

    await runMutation(() =>
      updateOneRecord({
        objectNameSingular:
          editingItem.kind === 'folder' ? 'recordListFolder' : 'recordList',
        idToUpdate: editingItem.id,
        updateOneRecordInput: { name: editingItem.name },
      }),
    );
    setEditingItem(null);
  };

  const createNewFolder = async () => {
    closeDropdown(RECORD_LISTS_CREATE_DROPDOWN_ID);
    setSearch('');
    setIsSaving(true);

    try {
      const untitledFolderName = t`Untitled`;
      const createdFolder = await createFolder({
        name: untitledFolderName,
        position: nextFolderPosition,
      });
      await apolloCoreClient.refetchQueries({ include: 'active' });
      setNewFolderDraft({
        kind: 'folder',
        id: createdFolder.id,
        name: untitledFolderName,
      });
    } catch {
      enqueueErrorSnackBar({ message: t`The folder could not be created.` });
    } finally {
      setIsSaving(false);
    }
  };

  const saveNewFolderName = async (name: string) => {
    if (!newFolderDraft) {
      return;
    }

    const nextName = name.trim() || t`Untitled`;

    await runMutation(() =>
      updateOneRecord({
        objectNameSingular: 'recordListFolder',
        idToUpdate: newFolderDraft.id,
        updateOneRecordInput: { name: nextName },
      }),
    );
    setNewFolderDraft(null);
  };

  const updateFolderPosition = (folderId: string, position: number) =>
    runMutation(() =>
      updateOneRecord({
        objectNameSingular: 'recordListFolder',
        idToUpdate: folderId,
        updateOneRecordInput: { position },
      }),
    );

  const updateListPosition = (listId: string, position: number) =>
    runMutation(() =>
      updateOneRecord({
        objectNameSingular: 'recordList',
        idToUpdate: listId,
        updateOneRecordInput: { position },
      }),
    );

  const handleReorder = (group: string, fromIndex: number, toIndex: number) => {
    if (!canManageLists || isSearching || isSaving) {
      return;
    }

    if (group === RECORD_LIST_FOLDER_SORTABLE_GROUP) {
      const reorderedFolders = moveArrayItem(sortedFolders, {
        fromIndex,
        toIndex,
      });

      void runMutation(() =>
        Promise.all(
          reorderedFolders.map((folder, position) =>
            updateOneRecord({
              objectNameSingular: 'recordListFolder',
              idToUpdate: folder.id,
              updateOneRecordInput: { position },
            }),
          ),
        ),
      );
      return;
    }

    if (!group.startsWith(RECORD_LIST_SORTABLE_GROUP_PREFIX)) {
      return;
    }

    const folderKey = group.slice(RECORD_LIST_SORTABLE_GROUP_PREFIX.length);
    const lists = (listsByFolderId[folderKey] ?? [])
      .slice()
      .sort((first, second) => first.position - second.position);
    const reorderedLists = moveArrayItem(lists, { fromIndex, toIndex });

    void runMutation(() =>
      Promise.all(
        reorderedLists.map((recordList, position) =>
          updateOneRecord({
            objectNameSingular: 'recordList',
            idToUpdate: recordList.id,
            updateOneRecordInput: { position },
          }),
        ),
      ),
    );
  };

  const handleMoveListToFolder = (listId: string, folderId: string) => {
    if (!canManageLists || isSearching || isSaving) {
      return;
    }

    const movedList = recordLists.find(
      (recordList) => recordList.id === listId,
    );

    if (!movedList) {
      return;
    }

    const nextPosition = recordLists.reduce(
      (position, recordList) =>
        recordList.folderId === folderId && recordList.id !== listId
          ? Math.max(position, recordList.position + 1)
          : position,
      0,
    );

    void runMutation(() =>
      updateOneRecord({
        objectNameSingular: 'recordList',
        idToUpdate: movedList.id,
        updateOneRecordInput: {
          folderId,
          position: nextPosition,
        },
      }),
    );
  };

  const content = (
    <StyledContent>
      <StyledPanel>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t`Search lists...`}
          aria-label={t`Search lists`}
        />
        <StyledExplorerHeader>
          <StyledExplorerTitle>{t`Lists`}</StyledExplorerTitle>
          {canManageLists && (
            <Dropdown
              dropdownId={RECORD_LISTS_CREATE_DROPDOWN_ID}
              dropdownPlacement="bottom-end"
              dropdownOffset={{ y: 4 }}
              clickableComponent={
                <LightIconButton
                  Icon={IconSquarePlus}
                  aria-label={t`Create a list or folder`}
                  title={t`Create a list or folder`}
                />
              }
              dropdownComponents={
                <DropdownContent
                  widthInPixels={GenericDropdownContentWidth.Narrow}
                >
                  <DropdownMenuItemsContainer>
                    <MenuItem
                      LeftIcon={IconLayoutGrid}
                      text={t`New list`}
                      onClick={() => {
                        closeDropdown(RECORD_LISTS_CREATE_DROPDOWN_ID);
                        navigate(AppPath.RecordListCreatePage);
                      }}
                    />
                    <MenuItem
                      LeftIcon={IconFolder}
                      text={t`New folder`}
                      onClick={() => void createNewFolder()}
                    />
                  </DropdownMenuItemsContainer>
                </DropdownContent>
              }
            />
          )}
        </StyledExplorerHeader>
        {editingItem && (
          <RecordListRenameForm
            editingItem={editingItem}
            isSaving={isSaving}
            onChange={setEditingItem}
            onCancel={() => setEditingItem(null)}
            onSave={() => void saveRename()}
          />
        )}
        <RecordListDragDropProvider
          onMoveListToFolder={handleMoveListToFolder}
          onReorder={handleReorder}
        >
          {topLevelLists.length > 0 && (
            <RecordListFolderSection
              folder={null}
              lists={topLevelLists}
              listSortableGroup={`${RECORD_LIST_SORTABLE_GROUP_PREFIX}${ROOT_RECORD_LIST_FOLDER_ID}`}
              canManageLists={shouldShowListActions}
              isReorderingDisabled={
                isSearching ||
                topLevelLists.length !==
                  (listCountByFolderId[ROOT_RECORD_LIST_FOLDER_ID] ?? 0)
              }
              isSaving={isSaving}
              newFolderDraft={null}
              onChangeNewFolderDraft={setNewFolderDraft}
              onSaveNewFolderName={(name) => void saveNewFolderName(name)}
              onSelectList={onClose}
              onPinFolder={() => undefined}
              onDeleteFolder={() => undefined}
              onPinList={(listId) =>
                void updateListPosition(
                  listId,
                  Math.min(...topLevelLists.map(({ position }) => position)) -
                    1,
                )
              }
              onDeleteList={(listId) =>
                void runMutation(() => deleteList(listId))
              }
              onStartRename={setEditingItem}
            />
          )}
          {displayedFolders.map((folder, folderIndex) => {
            const folderLists = (listsByFolderId[folder.id] ?? [])
              .slice()
              .sort((first, second) => first.position - second.position);

            return (
              <RecordListSortableItem
                key={folder.id}
                id={`record-list-folder:${folder.id}`}
                index={folderIndex}
                group={RECORD_LIST_FOLDER_SORTABLE_GROUP}
                disabled={
                  !canManageLists ||
                  isSearching ||
                  isSaving ||
                  displayedFolders.length === 1
                }
              >
                <RecordListFolderSection
                  folder={folder}
                  lists={folderLists}
                  isFolderDeleteDisabled={
                    (listCountByFolderId[folder.id] ?? 0) > 0
                  }
                  isFolderPinDisabled={folderIndex === 0}
                  listSortableGroup={`${RECORD_LIST_SORTABLE_GROUP_PREFIX}${folder.id}`}
                  canManageLists={shouldShowListActions}
                  isReorderingDisabled={
                    isSearching ||
                    folderLists.length !== (listCountByFolderId[folder.id] ?? 0)
                  }
                  isSaving={isSaving}
                  newFolderDraft={
                    newFolderDraft?.id === folder.id ? newFolderDraft : null
                  }
                  onChangeNewFolderDraft={setNewFolderDraft}
                  onSaveNewFolderName={(name) => void saveNewFolderName(name)}
                  onSelectList={onClose}
                  onPinFolder={(folderId) =>
                    void updateFolderPosition(
                      folderId,
                      Math.min(
                        ...sortedFolders.map(({ position }) => position),
                      ) - 1,
                    )
                  }
                  onDeleteFolder={(folderId) =>
                    void runMutation(() => deleteFolder(folderId))
                  }
                  onPinList={(listId) =>
                    void updateListPosition(
                      listId,
                      Math.min(...folderLists.map(({ position }) => position)) -
                        1,
                    )
                  }
                  onDeleteList={(listId) =>
                    void runMutation(() => deleteList(listId))
                  }
                  onStartRename={setEditingItem}
                />
              </RecordListSortableItem>
            );
          })}
        </RecordListDragDropProvider>
        {displayedFolders.length === 0 && topLevelLists.length === 0 && (
          <StyledEmptyState>
            {isSearching
              ? t`No lists match your search.`
              : canManageLists
                ? t`Create your first list.`
                : t`No lists are available to you.`}
          </StyledEmptyState>
        )}
      </StyledPanel>
    </StyledContent>
  );

  return onClose ? (
    <StyledSidePanel>
      <StyledSidePanelHeader>
        <StyledSidePanelTitle>{t`Lists`}</StyledSidePanelTitle>
        <LightIconButton
          Icon={IconX}
          aria-label={t`Close lists`}
          title={t`Close lists`}
          onClick={onClose}
        />
      </StyledSidePanelHeader>
      {content}
    </StyledSidePanel>
  ) : (
    <PageContainer>
      <PageCardLayout header={<PageCardHeader title={t`Lists`} />}>
        {content}
      </PageCardLayout>
    </PageContainer>
  );
};

export const RecordListsPage = () => <RecordLists />;

export const RecordListsPanel = ({ onClose }: { onClose: () => void }) => (
  <RecordLists onClose={onClose} />
);
