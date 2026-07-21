import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { SEQUENCE_STEP_TYPES } from 'twenty-shared/types';
import {
  IconArrowDown,
  IconArrowUp,
  IconBrandLinkedin,
  IconClock,
  IconListCheck,
  IconMail,
  IconTrash,
  IconUserMinus,
} from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { SequenceDelayStepEditor } from './SequenceDelayStepEditor';
import { SequenceEmailStepEditor } from './SequenceEmailStepEditor';
import { SequenceConnectionRequestStepEditor } from './SequenceConnectionRequestStepEditor';
import { SequenceTaskStepEditor } from './SequenceTaskStepEditor';
import { SequenceWithdrawConnectionRequestStepEditor } from './SequenceWithdrawConnectionRequestStepEditor';

const StyledCard = styled.article`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
`;

const StyledHeader = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledStepNumber = styled.span`
  align-items: center;
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.rounded};
  color: ${themeCssVariables.font.color.secondary};
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.sm};
  height: 24px;
  justify-content: center;
  width: 24px;
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex: 1;
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledHeaderActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledEditor = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

const STEP_PRESENTATION = {
  [SEQUENCE_STEP_TYPES.SEND_EMAIL]: {
    label: t`Send email`,
    Icon: IconMail,
  },
  [SEQUENCE_STEP_TYPES.DELAY]: { label: t`Wait`, Icon: IconClock },
  [SEQUENCE_STEP_TYPES.CREATE_TASK]: {
    label: t`Create task`,
    Icon: IconListCheck,
  },
  [SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST]: {
    label: t`Send LinkedIn connection request`,
    Icon: IconBrandLinkedin,
  },
  [SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST]: {
    label: t`Withdraw LinkedIn connection request`,
    Icon: IconUserMinus,
  },
};

type SequenceStepCardProps = {
  step: SequenceStepRecord;
  stepNumber: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  isEditable: boolean;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
  onDeleted: () => Promise<void>;
};

export const SequenceStepCard = ({
  step,
  stepNumber,
  canMoveUp,
  canMoveDown,
  canDelete,
  isEditable,
  onMoveUp,
  onMoveDown,
  onDeleted,
}: SequenceStepCardProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const { deleteOneRecord } = useDeleteOneRecord({
    objectNameSingular: 'sequenceStep',
  });
  const { enqueueErrorSnackBar } = useSnackBar();
  const presentation = STEP_PRESENTATION[step.type];
  const StepIcon = presentation.Icon;

  const deleteStep = async () => {
    setIsDeleting(true);

    try {
      await deleteOneRecord(step.id);
      await onDeleted();
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence step could not be deleted.`,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <StyledCard>
      <StyledHeader>
        <StyledStepNumber>{stepNumber}</StyledStepNumber>
        <StyledTitle>
          <StepIcon size={16} />
          {step.name || presentation.label}
        </StyledTitle>
        <StyledHeaderActions>
          <LightIconButton
            Icon={IconArrowUp}
            title={t`Move step up`}
            disabled={!canMoveUp}
            onClick={() => void onMoveUp()}
            accent="tertiary"
          />
          <LightIconButton
            Icon={IconArrowDown}
            title={t`Move step down`}
            disabled={!canMoveDown}
            onClick={() => void onMoveDown()}
            accent="tertiary"
          />
          <LightIconButton
            Icon={IconTrash}
            title={t`Delete step`}
            disabled={isDeleting || !canDelete}
            onClick={() => void deleteStep()}
            accent="tertiary"
          />
        </StyledHeaderActions>
      </StyledHeader>
      <StyledEditor>
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
        {step.settings.type ===
          SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST && (
          <SequenceWithdrawConnectionRequestStepEditor
            step={step}
            settings={step.settings}
            disabled={!isEditable}
          />
        )}
      </StyledEditor>
    </StyledCard>
  );
};
