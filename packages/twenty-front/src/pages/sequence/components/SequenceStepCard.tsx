import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { type KeyboardEvent, type MouseEvent, useState } from 'react';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_STEP_TYPES,
} from 'twenty-shared/types';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconTrash,
} from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { getSequenceStepPresentation } from '../utils/get-sequence-step-presentation';

const StyledCard = styled.article<{ isSelected: boolean }>`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid
    ${({ isSelected }) =>
      isSelected
        ? themeCssVariables.color.blue
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.boxShadow.strong
      : themeCssVariables.boxShadow.light};
  cursor: pointer;
  display: flex;
  max-width: 420px;
  min-height: 78px;
  overflow: hidden;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease,
    transform 120ms ease;
  width: 100%;

  &:hover {
    border-color: ${themeCssVariables.border.color.strong};
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.color.blue};
    outline-offset: 2px;
  }
`;

const StyledAccent = styled.div`
  background: ${themeCssVariables.color.blue};
  width: 3px;
`;

const StyledContent = styled.div`
  align-items: center;
  display: flex;
  flex: 1;
  gap: ${themeCssVariables.spacing[3]};
  min-width: 0;
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledIcon = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  height: 36px;
  justify-content: center;
  width: 36px;
`;

const StyledText = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing['0.5']};
  min-width: 0;
`;

const StyledEyebrow = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  text-transform: uppercase;
`;

const StyledTitle = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledSummary = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing['0.5']};
`;

const getStepSummary = (step: SequenceStepRecord): string => {
  switch (step.settings.type) {
    case SEQUENCE_STEP_TYPES.SEND_EMAIL:
      return step.settings.subject || t`Click to configure the email`;
    case SEQUENCE_STEP_TYPES.DELAY:
      return t`${step.settings.days}d ${step.settings.hours}h ${step.settings.minutes}m`;
    case SEQUENCE_STEP_TYPES.CREATE_TASK:
      return step.settings.titleTemplate || t`Click to configure the task`;
    case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
      return step.settings.noteTemplate || t`Invitation without a note`;
    case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
      return step.settings.messageTemplate || t`Click to configure the message`;
    case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
      return t`After ${step.settings.withdrawAfterDays}d ${step.settings.withdrawAfterHours}h`;
    case SEQUENCE_STEP_TYPES.CONDITION:
      return t`Splits into Yes and No paths`;
    case SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER:
      return t`Powered by Apollo`;
  }
};

const getExecutionLabel = (step: SequenceStepRecord): string => {
  if (step.settings.type === SEQUENCE_STEP_TYPES.CREATE_TASK) {
    return t`Manual`;
  }

  if (step.settings.type === SEQUENCE_STEP_TYPES.CONDITION) {
    return t`Condition`;
  }

  if (step.settings.type === SEQUENCE_STEP_TYPES.DELAY) {
    return t`Timing`;
  }

  return step.settings.executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL
    ? t`Manual`
    : t`Automated`;
};

type SequenceStepCardProps = {
  step: SequenceStepRecord;
  stepNumber: number;
  isSelected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
  onDelete: () => Promise<void>;
};

export const SequenceStepCard = ({
  step,
  stepNumber,
  isSelected,
  canMoveUp,
  canMoveDown,
  canDelete,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
}: SequenceStepCardProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const { enqueueErrorSnackBar } = useSnackBar();
  const presentation = getSequenceStepPresentation(step);
  const StepIcon = presentation.Icon;

  const deleteStep = async () => {
    setIsDeleting(true);

    try {
      await onDelete();
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence step could not be deleted.`,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const stopAndRun =
    (callback: () => Promise<void>) =>
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void callback();
    };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <StyledCard
      role="button"
      tabIndex={0}
      isSelected={isSelected}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-label={t`Configure step ${stepNumber}: ${presentation.label}`}
    >
      <StyledAccent />
      <StyledContent>
        <StyledIcon>
          <StepIcon size={18} />
        </StyledIcon>
        <StyledText>
          <StyledEyebrow>
            {t`Step ${stepNumber}`} · {getExecutionLabel(step)}
          </StyledEyebrow>
          <StyledTitle>{presentation.label}</StyledTitle>
          <StyledSummary>{getStepSummary(step)}</StyledSummary>
        </StyledText>
        <StyledActions>
          <LightIconButton
            Icon={IconArrowUp}
            title={t`Move step up`}
            disabled={!canMoveUp}
            onClick={stopAndRun(onMoveUp)}
            accent="tertiary"
          />
          <LightIconButton
            Icon={IconArrowDown}
            title={t`Move step down`}
            disabled={!canMoveDown}
            onClick={stopAndRun(onMoveDown)}
            accent="tertiary"
          />
          <LightIconButton
            Icon={IconTrash}
            title={t`Delete step`}
            disabled={isDeleting || !canDelete}
            onClick={stopAndRun(deleteStep)}
            accent="tertiary"
          />
          <IconChevronRight
            size={16}
            color={themeCssVariables.font.color.tertiary}
          />
        </StyledActions>
      </StyledContent>
    </StyledCard>
  );
};
