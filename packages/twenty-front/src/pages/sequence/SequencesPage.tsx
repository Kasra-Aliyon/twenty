import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { generatePath, Link, Navigate } from 'react-router-dom';
import {
  AppPath,
  FeatureFlagKey,
  type RecordGqlOperationFilter,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';
import { IconPlus, IconSend } from 'twenty-ui/icon';
import { Button, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { SequenceActionsMenu } from './components/SequenceActionsMenu';
import { StyledEmptyState, StyledPill } from './components/SequencePageStyles';
import { type SequenceRecord } from './types/SequenceRecords';

const SEQUENCES_PAGE_SIZE = 50;

type SequencesPageTab = 'active' | 'archived';

const StyledTableContainer = styled.div`
  flex: 1;
  overflow: auto;
`;

const StyledTable = styled.table`
  border-collapse: collapse;
  min-width: 900px;
  width: 100%;
`;

const StyledHeaderCell = styled.th`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[3]};
  text-align: left;
`;

const StyledRow = styled.tr`
  &:hover {
    background: ${themeCssVariables.background.transparent.lighter};
  }
`;

const StyledCell = styled.td`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.secondary};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledNameCell = styled(StyledCell)`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledNameLink = styled(Link)`
  color: inherit;
  display: block;
  text-decoration: none;
`;

const StyledStatusControl = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledLoadMore = styled.div`
  display: flex;
  justify-content: center;
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledTabs = styled.div`
  align-items: flex-end;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[4]};
  min-height: 40px;
  padding: 0 ${themeCssVariables.spacing[4]};
`;

const StyledTab = styled.button<{ isActive: boolean }>`
  background: transparent;
  border: 0;
  border-bottom: 2px solid
    ${({ isActive }) =>
      isActive ? themeCssVariables.color.blue : 'transparent'};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-family: inherit;
  height: 40px;
  padding: 0;
`;

const StyledActionsCell = styled(StyledCell)`
  width: 32px;
`;

const SequencesPageContent = () => {
  const [activeTab, setActiveTab] = useState<SequencesPageTab>('active');
  const { objectMetadataItem: sequenceObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequence' });
  const sequencePermissions = useObjectPermissionsForObject(
    sequenceObjectMetadataItem.id,
  );
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueErrorSnackBar } = useSnackBar();
  const filter: RecordGqlOperationFilter | undefined =
    activeTab === 'archived'
      ? {
          deletedAt: { is: 'NOT_NULL' },
        }
      : undefined;
  const {
    records: sequences,
    refetch,
    fetchMoreRecords,
    hasNextPage,
    loading,
  } = useFindManyRecords<SequenceRecord>({
    objectNameSingular: 'sequence',
    filter,
    orderBy: [{ name: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      deletedAt: true,
      name: true,
      status: true,
      enrolledCount: true,
      activeCount: true,
      completedCount: true,
      repliedCount: true,
      failedCount: true,
    },
    limit: SEQUENCES_PAGE_SIZE,
    withSoftDeleted: activeTab === 'archived',
  });

  const updateStatus = async (sequence: SequenceRecord, active: boolean) => {
    try {
      await updateOneRecord<SequenceRecord>({
        objectNameSingular: 'sequence',
        idToUpdate: sequence.id,
        updateOneRecordInput: {
          status: active ? SEQUENCE_STATUSES.ACTIVE : SEQUENCE_STATUSES.PAUSED,
        },
      });
      await refetch();
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence status could not be updated.`,
      });
    }
  };

  return (
    <PageContainer>
      <PageCardLayout
        header={
          <PageCardHeader
            icon={<IconSend size={18} />}
            title={t`Sequences`}
            actionButton={
              <Button
                title={t`New sequence`}
                Icon={IconPlus}
                size="small"
                to={AppPath.SequenceCreatePage}
                disabled={!sequencePermissions.canUpdateObjectRecords}
              />
            }
          />
        }
        secondaryBar={
          <StyledTabs>
            <StyledTab
              type="button"
              isActive={activeTab === 'active'}
              onClick={() => setActiveTab('active')}
            >
              {t`Active`}
            </StyledTab>
            <StyledTab
              type="button"
              isActive={activeTab === 'archived'}
              onClick={() => setActiveTab('archived')}
            >
              {t`Archived`}
            </StyledTab>
          </StyledTabs>
        }
      >
        {sequences.length === 0 ? (
          <StyledEmptyState>
            {activeTab === 'archived'
              ? t`Archived sequences will appear here.`
              : t`Create a sequence to automate email follow-ups and queue manual work.`}
          </StyledEmptyState>
        ) : (
          <StyledTableContainer>
            <StyledTable>
              <thead>
                <tr>
                  <StyledHeaderCell>{t`Name`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Status`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Enrolled`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Active`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Completed`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Replied`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Failed`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Reply rate`}</StyledHeaderCell>
                  <StyledHeaderCell aria-label={t`Actions`} />
                </tr>
              </thead>
              <tbody>
                {sequences.map((sequence) => {
                  const replyRate =
                    sequence.enrolledCount > 0
                      ? Math.round(
                          (sequence.repliedCount / sequence.enrolledCount) *
                            100,
                        )
                      : 0;

                  return (
                    <StyledRow key={sequence.id}>
                      <StyledNameCell>
                        <StyledNameLink
                          to={generatePath(AppPath.SequencePage, {
                            sequenceId: sequence.id,
                          })}
                        >
                          {sequence.name}
                        </StyledNameLink>
                      </StyledNameCell>
                      <StyledCell onClick={(event) => event.stopPropagation()}>
                        <StyledStatusControl>
                          {activeTab === 'active' && (
                            <Toggle
                              value={
                                sequence.status === SEQUENCE_STATUSES.ACTIVE
                              }
                              onChange={(active) =>
                                void updateStatus(sequence, active)
                              }
                              disabled={
                                !sequencePermissions.canUpdateObjectRecords
                              }
                              toggleSize="small"
                            />
                          )}
                          <StyledPill>
                            {activeTab === 'archived'
                              ? t`Archived`
                              : sequence.status}
                          </StyledPill>
                        </StyledStatusControl>
                      </StyledCell>
                      <StyledCell>{sequence.enrolledCount}</StyledCell>
                      <StyledCell>{sequence.activeCount}</StyledCell>
                      <StyledCell>{sequence.completedCount}</StyledCell>
                      <StyledCell>{sequence.repliedCount}</StyledCell>
                      <StyledCell>{sequence.failedCount}</StyledCell>
                      <StyledCell>{replyRate}%</StyledCell>
                      <StyledActionsCell>
                        <SequenceActionsMenu
                          sequence={sequence}
                          canArchive={
                            sequencePermissions.canSoftDeleteObjectRecords
                          }
                          canDestroy={
                            sequencePermissions.canDestroyObjectRecords
                          }
                          onArchived={async () => {
                            await refetch();
                          }}
                          onDestroyed={async () => {
                            await refetch();
                          }}
                          onRestored={async () => {
                            await refetch();
                          }}
                        />
                      </StyledActionsCell>
                    </StyledRow>
                  );
                })}
              </tbody>
            </StyledTable>
            {hasNextPage && (
              <StyledLoadMore>
                <Button
                  title={t`Load more sequences`}
                  variant="secondary"
                  size="small"
                  isLoading={loading}
                  onClick={() => void fetchMoreRecords()}
                />
              </StyledLoadMore>
            )}
          </StyledTableContainer>
        )}
      </PageCardLayout>
    </PageContainer>
  );
};

export const SequencesPage = () => {
  const isOutreachSequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );
  const doSequenceMetadataItemsExist = useDoObjectMetadataItemsExist([
    'sequence',
  ]);

  if (!isOutreachSequencesEnabled || !doSequenceMetadataItemsExist) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  return <SequencesPageContent />;
};
