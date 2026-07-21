import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { isRecordListsPanelOpenState } from '@/record-list/states/isRecordListsPanelOpenState';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { generatePath, Navigate, useNavigate } from 'react-router-dom';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  AppPath,
  FeatureFlagKey,
  RECORD_LIST_TYPES,
  type RecordListType,
} from 'twenty-shared/types';
import {
  IconBriefcase,
  IconBuildingSkyscraper,
  IconList,
  IconUser,
} from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { ModalContent, ModalFooter, ModalHeader } from 'twenty-ui/surfaces';

import {
  StyledCreateListActions,
  StyledCreateListContent,
  StyledCreateListFields,
  StyledCreateListFolderSelect,
  StyledCreateListNameIcon,
  StyledCreateListNameInput,
  StyledCreateListNameRow,
  StyledCreateListSection,
  StyledCreateListSectionTitle,
  StyledObjectTypeButton,
  StyledObjectTypePicker,
} from './components/RecordListCreatePageStyles';
import { ROOT_RECORD_LIST_FOLDER_ID } from './constants/record-list-folder.constants';
import {
  type RecordListFolderRecord,
  type RecordListRecord,
} from './types/RecordListRecords';

const RECORD_LIST_CREATE_MODAL_ID = 'record-list-create-modal';

const TRACKED_OBJECT_OPTIONS = [
  {
    type: RECORD_LIST_TYPES.COMPANY,
    label: t`Companies`,
    Icon: IconBuildingSkyscraper,
  },
  {
    type: RECORD_LIST_TYPES.PERSON,
    label: t`People`,
    Icon: IconUser,
  },
  {
    type: RECORD_LIST_TYPES.OPPORTUNITY,
    label: t`Opportunities`,
    Icon: IconBriefcase,
  },
] as const;

export const RecordListCreatePage = () => {
  const [name, setName] = useState('');
  const [recordListType, setRecordListType] = useState<RecordListType>(
    RECORD_LIST_TYPES.COMPANY,
  );
  const [folderId, setFolderId] = useState(ROOT_RECORD_LIST_FOLDER_ID);
  const isRecordListsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  );
  const setIsRecordListsPanelOpen = useSetAtomState(
    isRecordListsPanelOpenState,
  );
  const navigate = useNavigate();
  const { closeModal, openModal } = useModal();
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueErrorSnackBar } = useSnackBar();
  const { createOneRecord: createList, loading } =
    useCreateOneRecord<RecordListRecord>({
      objectNameSingular: 'recordList',
      skipPostOptimisticEffect: true,
    });
  const { records: recordLists } = useFindManyRecords<RecordListRecord>({
    objectNameSingular: 'recordList',
    recordGqlFields: { id: true, position: true, folderId: true },
    limit: QUERY_MAX_RECORDS,
    skip: !isRecordListsEnabled,
  });
  const { records: folders } = useFindManyRecords<RecordListFolderRecord>({
    objectNameSingular: 'recordListFolder',
    recordGqlFields: { id: true, name: true, position: true },
    orderBy: [{ position: 'AscNullsFirst' }],
    limit: QUERY_MAX_RECORDS,
    skip: !isRecordListsEnabled,
  });

  useEffect(() => {
    setIsRecordListsPanelOpen(true);
    openModal(RECORD_LIST_CREATE_MODAL_ID);

    return () => closeModal(RECORD_LIST_CREATE_MODAL_ID);
  }, [closeModal, openModal, setIsRecordListsPanelOpen]);

  if (!isRecordListsEnabled) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  const nextPosition = recordLists.reduce(
    (position, recordList) =>
      (recordList.folderId ?? ROOT_RECORD_LIST_FOLDER_ID) === folderId
        ? Math.max(position, recordList.position + 1)
        : position,
    0,
  );

  const createRecordList = async () => {
    try {
      const createdList = await createList({
        name,
        type: recordListType,
        folderId: folderId || null,
        position: nextPosition,
      });
      await apolloCoreClient.refetchQueries({ include: 'active' });

      closeModal(RECORD_LIST_CREATE_MODAL_ID);
      setIsRecordListsPanelOpen(false);
      navigate(
        generatePath(AppPath.RecordListPage, {
          recordListId: createdList.id,
        }),
      );
    } catch {
      enqueueErrorSnackBar({ message: t`The list could not be created.` });
    }
  };

  return (
    <ModalStatefulWrapper
      modalInstanceId={RECORD_LIST_CREATE_MODAL_ID}
      size="medium"
      padding="none"
      autoHeight
      isClosable
      renderInDocumentBody
      onClose={() => navigate(-1)}
    >
      <StyledCreateListContent
        onSubmit={(event) => {
          event.preventDefault();
          void createRecordList();
        }}
      >
        <ModalHeader autoHeight>{t`New list`}</ModalHeader>
        <ModalContent gap={5}>
          <StyledCreateListFields>
            <StyledCreateListNameRow>
              <StyledCreateListNameIcon>
                <IconList size={20} />
              </StyledCreateListNameIcon>
              <StyledCreateListNameInput
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t`e.g. Sales Pipeline`}
                aria-label={t`List name`}
                required
              />
            </StyledCreateListNameRow>

            <StyledCreateListSection>
              <StyledCreateListSectionTitle>
                {t`What are you looking to track?`}
              </StyledCreateListSectionTitle>
              <StyledObjectTypePicker>
                {TRACKED_OBJECT_OPTIONS.map(({ type, label, Icon }) => (
                  <StyledObjectTypeButton
                    key={type}
                    type="button"
                    isSelected={recordListType === type}
                    aria-pressed={recordListType === type}
                    onClick={() => setRecordListType(type)}
                  >
                    <Icon size={16} />
                    {label}
                  </StyledObjectTypeButton>
                ))}
              </StyledObjectTypePicker>
            </StyledCreateListSection>

            <StyledCreateListSection>
              <StyledCreateListSectionTitle>
                {t`Folder`}
              </StyledCreateListSectionTitle>
              <StyledCreateListFolderSelect
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                aria-label={t`List folder`}
              >
                <option value={ROOT_RECORD_LIST_FOLDER_ID}>
                  {t`No folder`}
                </option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </StyledCreateListFolderSelect>
            </StyledCreateListSection>
          </StyledCreateListFields>
        </ModalContent>
        <ModalFooter autoHeight>
          <StyledCreateListActions>
            <Button
              title={t`Cancel`}
              type="button"
              variant="secondary"
              onClick={() => {
                closeModal(RECORD_LIST_CREATE_MODAL_ID);
                navigate(-1);
              }}
            />
            <Button
              title={t`Create list`}
              type="submit"
              disabled={name.trim().length === 0}
              isLoading={loading}
            />
          </StyledCreateListActions>
        </ModalFooter>
      </StyledCreateListContent>
    </ModalStatefulWrapper>
  );
};
