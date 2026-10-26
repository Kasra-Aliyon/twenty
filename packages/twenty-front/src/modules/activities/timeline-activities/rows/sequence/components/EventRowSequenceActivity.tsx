import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';

import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import {
  getCallOutcomeLabel,
  getManualSequenceActivityLabel,
  readSequenceActivityDetails,
} from '@/sequence/utils/sequenceActivity';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledEvent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  white-space: normal;
`;

const StyledMetadata = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledNotes = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

type EventRowSequenceActivityProps = EventRowDynamicComponentProps;

export const EventRowSequenceActivity = ({
  event,
  authorFullName,
  createdAt,
}: EventRowSequenceActivityProps) => {
  const details = readSequenceActivityDetails(event.properties);
  const label = details?.outcome
    ? t`Call result: ${getCallOutcomeLabel(details.outcome)}`
    : details?.activity
      ? getManualSequenceActivityLabel(details.activity)
      : t`Sequence activity`;

  return (
    <StyledEvent>
      <div>{label}</div>
      <StyledMetadata>
        {authorFullName} · {createdAt} · {t`Manually recorded`}
      </StyledMetadata>
      {details?.notes && <StyledNotes>{details.notes}</StyledNotes>}
    </StyledEvent>
  );
};
