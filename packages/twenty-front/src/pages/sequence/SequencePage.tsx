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
import { Navigate, useParams } from 'react-router-dom';
import {
  AppPath,
  FeatureFlagKey,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';
import { IconPlayerPause, IconPlayerPlay, IconSend } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { SequenceContactsTable } from './components/SequenceContactsTable';
import { StyledPageContent, StyledPill } from './components/SequencePageStyles';
import { SequenceSettingsSection } from './components/SequenceSettingsSection';
import { SequenceStepList } from './components/SequenceStepList';
import {
  type SequenceEnrollmentRecord,
  type SequenceRecord,
} from './types/SequenceRecords';

type SequenceTab = 'steps' | 'contacts' | 'settings';

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

const SequencePageContent = () => {
  const { sequenceId } = useParams();
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
    recordGqlFields: {
      id: true,
      name: true,
      status: true,
      senderConnectedAccountId: true,
      settings: true,
      enrolledCount: true,
      activeCount: true,
      completedCount: true,
      repliedCount: true,
      failedCount: true,
    },
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
    skip: !sequenceId,
  });

  useEffect(() => {
    if (!sequenceId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refetchActiveEnrollments().catch(() => undefined);
    }, ACTIVE_ENROLLMENT_REFRESH_INTERVAL_MILLISECONDS);

    return () => window.clearInterval(intervalId);
  }, [refetchActiveEnrollments, sequenceId]);

  if (loading || !sequenceId) {
    return <RecordIndexSkeletonLoader />;
  }

  if (!sequence) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  const isActive = sequence.status === SEQUENCE_STATUSES.ACTIVE;
  const hasActiveEnrollments =
    (activeEnrollmentCount ?? activeEnrollments.length) > 0;

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
            title={sequence.name}
            tag={<StyledPill>{sequence.status}</StyledPill>}
            actionButton={
              <Button
                title={isActive ? t`Pause` : t`Activate`}
                Icon={isActive ? IconPlayerPause : IconPlayerPlay}
                variant={isActive ? 'secondary' : 'primary'}
                size="small"
                onClick={() => void toggleSequence()}
                disabled={!sequencePermissions.canUpdateObjectRecords}
              />
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
              {t`Steps`}
            </StyledTab>
            <StyledTab
              type="button"
              isActive={activeTab === 'contacts'}
              onClick={() => setActiveTab('contacts')}
            >
              {t`Contacts`} ({sequence.enrolledCount})
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
        <StyledPageContent>
          {activeTab === 'steps' && (
            <SequenceStepList
              sequenceId={sequence.id}
              isStructureLocked={hasActiveEnrollments}
              canAddOrReorder={
                !hasActiveEnrollments &&
                sequenceStepPermissions.canUpdateObjectRecords
              }
              canUpdateSteps={sequenceStepPermissions.canUpdateObjectRecords}
              canDeleteSteps={
                !hasActiveEnrollments &&
                sequenceStepPermissions.canSoftDeleteObjectRecords
              }
            />
          )}
          {activeTab === 'contacts' && (
            <SequenceContactsTable
              sequenceId={sequence.id}
              canUpdate={sequenceEnrollmentPermissions.canUpdateObjectRecords}
              onEnrollmentUpdated={async () => {
                await Promise.all([refetch(), refetchActiveEnrollments()]);
              }}
            />
          )}
          {activeTab === 'settings' && (
            <SequenceSettingsSection
              sequence={sequence}
              canUpdate={sequencePermissions.canUpdateObjectRecords}
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
