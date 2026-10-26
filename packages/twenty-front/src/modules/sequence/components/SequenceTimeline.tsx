import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { EventList } from '@/activities/timeline-activities/components/EventList';
import { TimelineActivityContext } from '@/activities/timeline-activities/contexts/TimelineActivityContext';
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { SequenceActivityForm } from '@/sequence/components/SequenceActivityForm';
import { SEQUENCE_ACTIVITY_FILTER } from '@/sequence/utils/sequenceActivity';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  min-height: 0;
`;

const StyledActions = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledMessage = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  padding: ${themeCssVariables.spacing[4]} 0;
`;

export const SequenceTimeline = ({
  personId,
  taskId,
  sequenceEnrollmentId,
  isCallTask,
  canRecord,
}: {
  personId: string;
  taskId?: string;
  sequenceEnrollmentId?: string;
  isCallTask: boolean;
  canRecord: boolean;
}) => {
  const targetableObject = {
    id: personId,
    targetObjectNameSingular: CoreObjectNameSingular.Person,
  };
  const {
    timelineActivities,
    firstQueryLoading,
    loadingMore,
    hasNextPage,
    error,
    fetchMoreRecords,
    refetch,
  } = useTimelineActivities(targetableObject, SEQUENCE_ACTIVITY_FILTER);
  const { enqueueErrorSnackBar } = useSnackBar();

  const loadHistory = async (load: () => Promise<unknown>) => {
    try {
      await load();
    } catch {
      enqueueErrorSnackBar({
        message: t`Activity history could not be loaded.`,
      });
    }
  };

  return (
    <StyledContainer>
      <SequenceActivityForm
        key={`${personId}:${taskId ?? ''}`}
        personId={personId}
        taskId={taskId}
        sequenceEnrollmentId={sequenceEnrollmentId}
        isCallTask={isCallTask}
        canRecord={canRecord}
        onSaved={refetch}
      />
      <StyledActions>
        <span>{t`Outreach activity`}</span>
        <Button
          title={t`Refresh history`}
          size="small"
          variant="tertiary"
          disabled={firstQueryLoading || loadingMore}
          onClick={() => void loadHistory(refetch)}
        />
      </StyledActions>
      {firstQueryLoading ? (
        <StyledMessage role="status">{t`Loading activity…`}</StyledMessage>
      ) : error ? (
        <StyledMessage role="alert">{t`Activity history could not be loaded. Please try refreshing.`}</StyledMessage>
      ) : timelineActivities.length === 0 ? (
        <StyledMessage>{t`No outreach activity recorded yet. Synced email and LinkedIn events, task activity, and manually recorded results appear here.`}</StyledMessage>
      ) : (
        <TimelineActivityContext.Provider value={{ recordId: personId }}>
          <EventList
            title={t`Outreach activity`}
            targetableObject={targetableObject}
            events={timelineActivities}
          />
        </TimelineActivityContext.Provider>
      )}
      {hasNextPage && (
        <Button
          title={t`Load older activity`}
          size="small"
          variant="secondary"
          isLoading={loadingMore}
          disabled={loadingMore}
          onClick={() => void loadHistory(fetchMoreRecords)}
        />
      )}
    </StyledContainer>
  );
};
