import { styled } from '@linaria/react';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { SkeletonLoader } from '@/activities/components/SkeletonLoader';
import { EventList } from '@/activities/timeline-activities/components/EventList';
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { useOpenSequenceTimeline } from '@/sequence/hooks/useOpenSequenceTimeline';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';
import { t } from '@lingui/core/macro';
import { CoreObjectNameSingular, FeatureFlagKey } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';
import { IconTimelineEvent } from 'twenty-ui/icon';
import {
  AnimatedPlaceholder,
  AnimatedPlaceholderEmptyContainer,
  AnimatedPlaceholderEmptySubTitle,
  AnimatedPlaceholderEmptyTextContainer,
  AnimatedPlaceholderEmptyTitle,
  EMPTY_PLACEHOLDER_TRANSITION_PROPS,
} from 'twenty-ui/feedback';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledMainContainer = styled.div`
  align-items: flex-start;
  align-self: stretch;
  border-top: none;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};

  justify-content: center;
  overflow: auto;
  padding-left: ${themeCssVariables.spacing[6]};
  padding-right: ${themeCssVariables.spacing[6]};
  padding-top: ${themeCssVariables.spacing[6]};

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    border-top: 1px solid ${themeCssVariables.border.color.medium};
    padding-right: ${themeCssVariables.spacing[1]};
    padding-left: ${themeCssVariables.spacing[1]};
  }
`;

const StyledSidePanelPlaceholderWrapper = styled.div`
  > * {
    height: auto;
    padding-top: ${themeCssVariables.spacing[8]};
  }
`;

const StyledActions = styled.div`
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[6]} 0;
`;

export const TimelineCard = () => {
  const targetRecord = useTargetRecord();
  const { isInSidePanel } = useLayoutRenderingContext();
  const { openSequenceTimeline } = useOpenSequenceTimeline();
  const sequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );
  const sequenceTimelineButton =
    sequencesEnabled &&
    targetRecord.targetObjectNameSingular === CoreObjectNameSingular.Person ? (
      <StyledActions>
        <Button
          Icon={IconTimelineEvent}
          title={t`Sequence timeline`}
          variant="secondary"
          size="small"
          onClick={() => openSequenceTimeline({ personId: targetRecord.id })}
        />
      </StyledActions>
    ) : null;
  const {
    timelineActivities,
    firstQueryLoading,
    loadingMore,
    fetchMoreRecords,
  } = useTimelineActivities(targetRecord);

  const isTimelineActivitiesEmpty = timelineActivities.length === 0;

  if (firstQueryLoading === true) {
    return (
      <>
        {sequenceTimelineButton}
        <SkeletonLoader withSubSections />
      </>
    );
  }

  if (isTimelineActivitiesEmpty) {
    const placeholderContent = (
      <AnimatedPlaceholderEmptyContainer
        // oxlint-disable-next-line react/jsx-props-no-spreading
        {...EMPTY_PLACEHOLDER_TRANSITION_PROPS}
      >
        <AnimatedPlaceholder type="emptyTimeline" />
        <AnimatedPlaceholderEmptyTextContainer>
          <AnimatedPlaceholderEmptyTitle>
            {t`No activity yet`}
          </AnimatedPlaceholderEmptyTitle>
          <AnimatedPlaceholderEmptySubTitle>
            {t`There is no activity associated with this record.`}
          </AnimatedPlaceholderEmptySubTitle>
        </AnimatedPlaceholderEmptyTextContainer>
      </AnimatedPlaceholderEmptyContainer>
    );

    return (
      <>
        {sequenceTimelineButton}
        {isInSidePanel ? (
          <StyledSidePanelPlaceholderWrapper>
            {placeholderContent}
          </StyledSidePanelPlaceholderWrapper>
        ) : (
          placeholderContent
        )}
      </>
    );
  }

  return (
    <>
      {sequenceTimelineButton}
      <StyledMainContainer>
        <EventList
          targetableObject={targetRecord}
          title={t`All`}
          events={timelineActivities ?? []}
        />
        <CustomResolverFetchMoreLoader
          loading={loadingMore}
          onLastRowVisible={fetchMoreRecords}
        />
      </StyledMainContainer>
    </>
  );
};
