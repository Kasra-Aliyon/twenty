import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { RecordIndexSkeletonLoader } from '@/object-record/record-index/components/RecordIndexSkeletonLoader';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  AppPath,
  FeatureFlagKey,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';
import { IconPlayerPause, IconPlayerPlay, IconSend } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { SequenceActionsMenu } from './components/SequenceActionsMenu';
import { SequenceAnalyticsSection } from './components/SequenceAnalyticsSection';
import { SequenceContactsTable } from './components/SequenceContactsTable';
import { StyledPageContent, StyledPill } from './components/SequencePageStyles';
import { SequenceSettingsSection } from './components/SequenceSettingsSection';
import { SequenceStepList } from './components/SequenceStepList';
import {
  type SequenceEnrollmentRecord,
  type SequenceRecord,
} from './types/SequenceRecords';
import { getSequenceStatusErrorMessage } from './utils/get-sequence-status-error-message';

type SequenceTab = 'steps' | 'contacts' | 'analytics' | 'settings';

const ACTIVE_ENROLLMENT_REFRESH_INTERVAL_MILLISECONDS = 15_000;

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

const StyledHeaderActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledArchivedNotice = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.secondary};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const SequencePageContent = () => {
  const { sequenceId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SequenceTab>('steps');
  const { objectMetadataItem: sequenceObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequence' });
  const { objectMetadataItem: sequenceStepObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequenceStep' });
  const { objectMetadataItem: sequenceEnrollmentObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequenceEnrollment' });
  const sequencePermissions = useObjectPermissionsForObject(
    sequenceObjectMetadataItem.id,
  );
  const sequenceStepPermissions = useObjectPermissionsForObject(
    sequenceStepObjectMetadataItem.id,
  );
  const sequenceEnrollmentPermissions = useObjectPermissionsForObject(
    sequenceEnrollmentObjectMetadataItem.id,
  );
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueErrorSnackBar } = useSnackBar();
  const {
    record: sequence,
    loading,
    refetch,
  } = useFindOneRecord<SequenceRecord>({
    objectNameSingular: 'sequence',
    objectRecordId: sequenceId,
    withSoftDeleted: true,
    recordGqlFields: {
      id: true,
      deletedAt: true,
      name: true,
      status: true,
      senderConnectedAccountId: true,
      settings: true,
      enrolledCount: true,
    },
  });
  const {
    records: enrollments,
    totalCount: enrollmentCount,
    refetch: refetchEnrollments,
  } = useFindManyRecords<SequenceEnrollmentRecord>({
    objectNameSingular: 'sequenceEnrollment',
    filter: { sequenceId: { eq: sequenceId ?? '' } },
    recordGqlFields: { id: true },
    limit: 1,
    skip: !sequenceId || Boolean(sequence?.deletedAt),
  });
  const {
    records: activeEnrollments,
    totalCount: activeEnrollmentCount,
    refetch: refetchActiveEnrollments,
  } = useFindManyRecords<SequenceEnrollmentRecord>({
    objectNameSingular: 'sequenceEnrollment',
    filter: {
      and: [
        { sequenceId: { eq: sequenceId ?? '' } },
        { status: { eq: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE } },
      ],
    },
    recordGqlFields: { id: true },
    limit: 1,
    skip: !sequenceId || Boolean(sequence?.deletedAt),
  });

  useEffect(() => {
    if (!sequenceId || sequence?.deletedAt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void Promise.all([
        refetchEnrollments(),
        refetchActiveEnrollments(),
      ]).catch(() => undefined);
    }, ACTIVE_ENROLLMENT_REFRESH_INTERVAL_MILLISECONDS);

    return () => window.clearInterval(intervalId);
  }, [
    refetchActiveEnrollments,
    refetchEnrollments,
    sequence?.deletedAt,
    sequenceId,
  ]);

  if (loading || !sequenceId) {
    return <RecordIndexSkeletonLoader />;
  }

  if (!sequence) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  const isActive = sequence.status === SEQUENCE_STATUSES.ACTIVE;
  const isArchived = sequence.deletedAt !== null;
  const hasActiveEnrollments =
    (activeEnrollmentCount ?? activeEnrollments.length) > 0;
  const displayedEnrollmentCount = enrollmentCount ?? enrollments.length;

  const toggleSequence = async () => {
    try {
      await updateOneRecord<SequenceRecord>({
        objectNameSingular: 'sequence',
        idToUpdate: sequence.id,
        updateOneRecordInput: {
          status: isActive
            ? SEQUENCE_STATUSES.PAUSED
            : SEQUENCE_STATUSES.ACTIVE,
        },
      });
      await Promise.all([
        refetch(),
        refetchEnrollments(),
        refetchActiveEnrollments(),
      ]);
    } catch (error) {
      enqueueErrorSnackBar({
        message: getSequenceStatusErrorMessage({
          error,
          fallbackMessage: t`The sequence status could not be updated.`,
        }),
      });
    }
  };

  return (
    <PageContainer>
      <PageCardLayout
        header={
          <PageCardHeader
            icon={<IconSend size={18} />}
            title={sequence.name}
            tag={
              <StyledPill>
                {isArchived ? t`Archived` : sequence.status}
              </StyledPill>
            }
            actionButton={
              <StyledHeaderActions>
                {!isArchived && (
                  <Button
                    title={isActive ? t`Pause` : t`Activate`}
                    Icon={isActive ? IconPlayerPause : IconPlayerPlay}
                    variant={isActive ? 'secondary' : 'primary'}
                    size="small"
                    onClick={() => void toggleSequence()}
                    disabled={!sequencePermissions.canUpdateObjectRecords}
                  />
                )}
                <SequenceActionsMenu
                  sequence={sequence}
                  canArchive={sequencePermissions.canSoftDeleteObjectRecords}
                  canDestroy={sequencePermissions.canDestroyObjectRecords}
                  onArchived={async () => {
                    await Promise.all([
                      refetch(),
                      refetchEnrollments(),
                      refetchActiveEnrollments(),
                    ]);
                  }}
                  onDestroyed={() => navigate(AppPath.SequencesPage)}
                  onRestored={async () => {
                    await Promise.all([
                      refetch(),
                      refetchEnrollments(),
                      refetchActiveEnrollments(),
                    ]);
                  }}
                />
              </StyledHeaderActions>
            }
          />
        }
        secondaryBar={
          <StyledTabs>
            <StyledTab
              type="button"
              isActive={activeTab === 'steps'}
              onClick={() => setActiveTab('steps')}
            >
              {t`Builder`}
            </StyledTab>
            <StyledTab
              type="button"
              isActive={activeTab === 'contacts'}
              onClick={() => setActiveTab('contacts')}
            >
              {t`Contacts`} ({displayedEnrollmentCount})
            </StyledTab>
            <StyledTab
              type="button"
              isActive={activeTab === 'analytics'}
              onClick={() => setActiveTab('analytics')}
            >
              {t`Analytics`}
            </StyledTab>
            <StyledTab
              type="button"
              isActive={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
            >
              {t`Settings`}
            </StyledTab>
          </StyledTabs>
        }
      >
        {isArchived && (
          <StyledArchivedNotice>
            {t`This sequence is archived and read-only. Restoring it keeps the sequence inactive; contacts removed during archiving are not restarted.`}
          </StyledArchivedNotice>
        )}
        <StyledPageContent>
          {activeTab === 'steps' && (
            <SequenceStepList
              sequenceId={sequence.id}
              isStructureLocked={isArchived || isActive || hasActiveEnrollments}
              canAddOrReorder={
                !isArchived &&
                !isActive &&
                !hasActiveEnrollments &&
                sequenceStepPermissions.canUpdateObjectRecords
              }
              canUpdateSteps={
                !isArchived &&
                !isActive &&
                sequenceStepPermissions.canUpdateObjectRecords
              }
              canDeleteSteps={
                !isArchived &&
                !isActive &&
                !hasActiveEnrollments &&
                sequenceStepPermissions.canSoftDeleteObjectRecords
              }
            />
          )}
          {activeTab === 'contacts' && (
            <SequenceContactsTable
              sequenceId={sequence.id}
              canUpdate={
                !isArchived &&
                sequenceEnrollmentPermissions.canUpdateObjectRecords
              }
              onEnrollmentUpdated={async () => {
                await Promise.all([
                  refetch(),
                  refetchEnrollments(),
                  refetchActiveEnrollments(),
                ]);
              }}
            />
          )}
          {activeTab === 'analytics' && (
            <SequenceAnalyticsSection sequenceId={sequence.id} />
          )}
          {activeTab === 'settings' && (
            <SequenceSettingsSection
              sequence={sequence}
              canUpdate={
                !isArchived &&
                !isActive &&
                !hasActiveEnrollments &&
                sequencePermissions.canUpdateObjectRecords
              }
            />
          )}
        </StyledPageContent>
      </PageCardLayout>
    </PageContainer>
  );
};

export const SequencePage = () => {
  const isOutreachSequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );
  const doSequenceMetadataItemsExist = useDoObjectMetadataItemsExist([
    'sequence',
    'sequenceStep',
    'sequenceEnrollment',
  ]);

  if (!isOutreachSequencesEnabled || !doSequenceMetadataItemsExist) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  return <SequencePageContent />;
};
