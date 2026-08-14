import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';

import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import { EventRowItem } from '@/activities/timeline-activities/rows/components/EventRowItem';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledRowContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
  width: 100%;
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  overflow: hidden;
`;

const StyledItemTitleDate = styled.div`
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    display: none;
  }
  color: ${themeCssVariables.font.color.tertiary};
  padding: 0 ${themeCssVariables.spacing[1]};
`;

type EventRowLinkedinInteractionProps = EventRowDynamicComponentProps;

const getInteractionLabel = (eventName: string) => {
  switch (eventName) {
    case 'linkedin.connection-request-sent':
      return t`sent a LinkedIn connection request`;
    case 'linkedin.connection-request-withdrawn':
      return t`withdrew the LinkedIn connection request`;
    case 'linkedin.connection-established':
      return t`connected on LinkedIn`;
    case 'linkedin.message-sent':
      return t`sent a LinkedIn message`;
    case 'linkedin.message-received':
      return t`received a LinkedIn message`;
    default:
      return t`recorded a LinkedIn interaction`;
  }
};

export const EventRowLinkedinInteraction = ({
  authorFullName,
  createdAt,
  event,
}: EventRowLinkedinInteractionProps) => (
  <StyledRowContainer>
    <StyledRow>
      <EventRowItem>{authorFullName}</EventRowItem>
      <EventRowItem variant="action">
        {getInteractionLabel(event.name)}
      </EventRowItem>
    </StyledRow>
    <StyledItemTitleDate>{createdAt}</StyledItemTitleDate>
  </StyledRowContainer>
);
