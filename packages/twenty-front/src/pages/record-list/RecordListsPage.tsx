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
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  AppPath,
  FeatureFlagKey,
  RECORD_LIST_TYPES,
} from 'twenty-shared/types';
import { IconPlus, IconX } from 'twenty-ui/icon';
import { LightIconButton, SearchInput } from 'twenty-ui/input';

import { RecordListFolderSection } from './components/RecordListFolderSection';
import { RecordListManagementForms } from './components/RecordListManagementForms';
import { RecordListRenameForm } from './components/RecordListRenameForm';
import {
  StyledContent,
  StyledEmptyState,
  StyledExplorerHeader,
  StyledExplorerTitle,
  StyledManagementPanel,
  StyledPanel,
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

export const RecordListsPage = () => {
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<EditingRecordListItem | null>(
    null,
  );
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isRecordListsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  );
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueErrorSnackBar } = useSnackBar();
  const { objectMetadataItem: recordListObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'recordList' });
  const recordListPermissions = useObjectPermissionsForObject(
    recordListObjectMetadataItem.id,
  );
  const canManageLists = recordListPermissions.canUpdateObjectRecords;
  const { createOneRecord: createFolder } = useCreateOneRecord({
    objectNameSingular: 'recordListFolder',
    skipPostOptimisticEffect: true,
  });
  const { createOneRecord: createList } = useCreateOneRecord({
    objectNameSingular: 'recordList',
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
  const nextListPositionByFolderId = recordLists.reduce<Record<string, number>>(
    (positions, recordList) => {
      const folderKey = getRecordListFolderKey(recordList.folderId);

      return {
        ...positions,
        [folderKey]: Math.max(
          positions[folderKey] ?? 0,
          recordList.position + 1,
        ),
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

  return (
    <PageContainer>
      <PageCardLayout header={<PageCardHeader title={t`Lists`} />}>
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
                <LightIconButton
                  Icon={isManagementOpen ? IconX : IconPlus}
                  aria-label={
                    isManagementOpen
                      ? t`Close list management`
                      : t`Create a list or folder`
                  }
                  title={
                    isManagementOpen
                      ? t`Close list management`
                      : t`Create a list or folder`
                  }
                  active={isManagementOpen}
                  onClick={() => setIsManagementOpen((isOpen) => !isOpen)}
                />
              )}
            </StyledExplorerHeader>
            {canManageLists && isManagementOpen && (
              <StyledManagementPanel>
                <RecordListManagementForms
                  folders={sortedFolders}
                  nextListPositionByFolderId={nextListPositionByFolderId}
                  isSaving={isSaving}
                  onCreateFolder={(name) =>
                    void runMutation(() =>
                      createFolder({ name, position: nextFolderPosition }),
                    )
                  }
                  onCreateList={(input) =>
                    void runMutation(() => createList(input))
                  }
                />
              </StyledManagementPanel>
            )}
            {editingItem && (
              <RecordListRenameForm
                editingItem={editingItem}
                isSaving={isSaving}
                onChange={setEditingItem}
                onCancel={() => setEditingItem(null)}
                onSave={() => void saveRename()}
              />
            )}
            {topLevelLists.length > 0 && (
              <RecordListFolderSection
                folder={null}
                folderIndex={0}
                folderCount={displayedFolders.length}
                lists={topLevelLists}
                folders={sortedFolders}
                listCountByFolderId={listCountByFolderId}
                nextListPositionByFolderId={nextListPositionByFolderId}
                canManageLists={canManageLists}
                isReorderingDisabled={isSearching}
                isSaving={isSaving}
                onUpdateFolderPosition={() => undefined}
                onDeleteFolder={() => undefined}
                onUpdateList={(listId, input) =>
                  void runMutation(() =>
                    updateOneRecord({
                      objectNameSingular: 'recordList',
                      idToUpdate: listId,
                      updateOneRecordInput: input,
                    }),
                  )
                }
                onDeleteList={(listId) =>
                  void runMutation(() => deleteList(listId))
                }
                onStartRename={setEditingItem}
              />
            )}
            {displayedFolders.map((folder, folderIndex) => (
              <RecordListFolderSection
                key={folder.id}
                folder={folder}
                folderIndex={folderIndex}
                folderCount={displayedFolders.length}
                lists={(listsByFolderId[folder.id] ?? [])
                  .slice()
                  .sort((first, second) => first.position - second.position)}
                folders={sortedFolders}
                listCountByFolderId={listCountByFolderId}
                nextListPositionByFolderId={nextListPositionByFolderId}
                canManageLists={canManageLists}
                isReorderingDisabled={isSearching}
                isSaving={isSaving}
                onUpdateFolderPosition={(folderId, position) =>
                  void runMutation(() =>
                    updateOneRecord({
                      objectNameSingular: 'recordListFolder',
                      idToUpdate: folderId,
                      updateOneRecordInput: { position },
                    }),
                  )
                }
                onDeleteFolder={(folderId) =>
                  void runMutation(() => deleteFolder(folderId))
                }
                onUpdateList={(listId, input) =>
                  void runMutation(() =>
                    updateOneRecord({
                      objectNameSingular: 'recordList',
                      idToUpdate: listId,
                      updateOneRecordInput: input,
                    }),
                  )
                }
                onDeleteList={(listId) =>
                  void runMutation(() => deleteList(listId))
                }
                onStartRename={setEditingItem}
              />
            ))}
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
      </PageCardLayout>
    </PageContainer>
  );
};
