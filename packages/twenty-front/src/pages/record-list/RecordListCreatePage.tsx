import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { isRecordListsPanelOpenState } from '@/record-list/states/isRecordListsPanelOpenState';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
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

import {
  StyledCreateListActions,
  StyledCreateListContent,
  StyledCreateListNameIcon,
  StyledCreateListNameInput,
  StyledCreateListNameRow,
  StyledCreateListSection,
  StyledCreateListSectionTitle,
  StyledObjectTypeButton,
  StyledObjectTypePicker,
} from './components/RecordListCreatePageStyles';
import { type RecordListRecord } from './types/RecordListRecords';

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
  const isRecordListsEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  );
  const setIsRecordListsPanelOpen = useSetAtomState(
    isRecordListsPanelOpenState,
  );
  const navigate = useNavigate();
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

  useEffect(() => {
    setIsRecordListsPanelOpen(true);
  }, [setIsRecordListsPanelOpen]);

  if (!isRecordListsEnabled) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  const nextPosition = recordLists.reduce(
    (position, recordList) =>
      recordList.folderId === null
        ? Math.max(position, recordList.position + 1)
        : position,
    0,
  );

  const createRecordList = async () => {
    try {
      const createdList = await createList({
        name,
        type: recordListType,
        folderId: null,
        position: nextPosition,
      });
      await apolloCoreClient.refetchQueries({ include: 'active' });

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
    <PageContainer>
      <PageCardLayout header={<PageCardHeader title={t`New list`} />}>
        <StyledCreateListContent
          onSubmit={(event) => {
            event.preventDefault();
            void createRecordList();
          }}
        >
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

          <StyledCreateListActions>
            <Button
              title={t`Cancel`}
              variant="secondary"
              onClick={() => window.history.back()}
            />
            <Button
              title={t`Create list`}
              type="submit"
              disabled={name.trim().length === 0}
              isLoading={loading}
            />
          </StyledCreateListActions>
        </StyledCreateListContent>
      </PageCardLayout>
    </PageContainer>
  );
};
