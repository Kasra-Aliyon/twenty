import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_STEP_TYPES,
} from 'twenty-shared/types';
import { IconX } from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { getSequenceStepPresentation } from '../utils/get-sequence-step-presentation';
import { SequenceConditionStepEditor } from './SequenceConditionStepEditor';
import { SequenceConnectionRequestStepEditor } from './SequenceConnectionRequestStepEditor';
import { SequenceDelayStepEditor } from './SequenceDelayStepEditor';
import { SequenceEmailStepEditor } from './SequenceEmailStepEditor';
import { SequenceEnrichPhoneNumberStepEditor } from './SequenceEnrichPhoneNumberStepEditor';
import { SequenceLinkedInMessageStepEditor } from './SequenceLinkedInMessageStepEditor';
import { SequenceTaskStepEditor } from './SequenceTaskStepEditor';
import { SequenceWithdrawConnectionRequestStepEditor } from './SequenceWithdrawConnectionRequestStepEditor';

const StyledPanel = styled.aside`
  background: ${themeCssVariables.background.secondary};
  border-left: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

const StyledHeader = styled.header`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 60px;
  padding: 0 ${themeCssVariables.spacing[4]};
`;

const StyledIcon = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  height: 32px;
  justify-content: center;
  width: 32px;
`;

const StyledHeading = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
`;

const StyledTitle = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledMeta = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledEditor = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  overflow: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

const getExecutionLabel = (step: SequenceStepRecord): string => {
  if (
    step.settings.type === SEQUENCE_STEP_TYPES.CONDITION ||
    step.settings.type === SEQUENCE_STEP_TYPES.DELAY
  ) {
    return step.settings.type === SEQUENCE_STEP_TYPES.CONDITION
      ? t`Decision`
      : t`Timing`;
  }

  if (step.settings.type === SEQUENCE_STEP_TYPES.CREATE_TASK) {
    return t`Manual`;
  }

  return step.settings.executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL
    ? t`Manual`
    : t`Automated`;
};

type SequenceStepEditorPanelProps = {
  step: SequenceStepRecord;
  isEditable: boolean;
  onClose: () => void;
};

export const SequenceStepEditorPanel = ({
  step,
  isEditable,
  onClose,
}: SequenceStepEditorPanelProps) => {
  const presentation = getSequenceStepPresentation(step);
  const StepIcon = presentation.Icon;

  return (
    <StyledPanel>
      <StyledHeader>
        <StyledIcon>
          <StepIcon size={18} />
        </StyledIcon>
        <StyledHeading>
          <StyledTitle>{presentation.label}</StyledTitle>
          <StyledMeta>
            {getExecutionLabel(step)} · {presentation.category}
          </StyledMeta>
        </StyledHeading>
        <LightIconButton
          Icon={IconX}
          title={t`Close step details`}
          onClick={onClose}
          accent="tertiary"
        />
      </StyledHeader>
      <StyledEditor key={step.id}>
        {step.settings.type === SEQUENCE_STEP_TYPES.SEND_EMAIL && (
          <SequenceEmailStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type === SEQUENCE_STEP_TYPES.DELAY && (
          <SequenceDelayStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type === SEQUENCE_STEP_TYPES.CREATE_TASK && (
          <SequenceTaskStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type === SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST && (
          <SequenceConnectionRequestStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type === SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE && (
          <SequenceLinkedInMessageStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type ===
          SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST && (
          <SequenceWithdrawConnectionRequestStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type === SEQUENCE_STEP_TYPES.CONDITION && (
          <SequenceConditionStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
        {step.settings.type === SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER && (
          <SequenceEnrichPhoneNumberStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
      </StyledEditor>
    </StyledPanel>
  );
};
