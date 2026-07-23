import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  type SequenceActionExecutionMode,
} from 'twenty-shared/types';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { StyledField, StyledInput, StyledTextarea } from './SequencePageStyles';

const StyledModeSection = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledModeHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: space-between;
`;

const StyledModeDescription = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  height: 32px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

type SequenceExecutionModeFieldsProps = {
  executionMode: SequenceActionExecutionMode;
  manualTaskTitle: string;
  manualTaskDescription: string;
  onExecutionModeChange: (mode: SequenceActionExecutionMode) => void;
  onManualTaskTitleChange: (title: string) => void;
  onManualTaskDescriptionChange: (description: string) => void;
};

export const SequenceExecutionModeFields = ({
  executionMode,
  manualTaskTitle,
  manualTaskDescription,
  onExecutionModeChange,
  onManualTaskTitleChange,
  onManualTaskDescriptionChange,
}: SequenceExecutionModeFieldsProps) => (
  <StyledModeSection>
    <StyledModeHeader>
      <div>
        <div>{t`Execution`}</div>
        <StyledModeDescription>
          {executionMode === SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED
            ? t`Handled automatically when the contact reaches this step.`
            : t`Creates a task at the right time and waits for completion.`}
        </StyledModeDescription>
      </div>
      <StyledSelect
        value={executionMode}
        onChange={(event) =>
          onExecutionModeChange(
            event.target.value as SequenceActionExecutionMode,
          )
        }
      >
        <option value={SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED}>
          {t`Automated`}
        </option>
        <option value={SEQUENCE_ACTION_EXECUTION_MODES.MANUAL}>
          {t`Manual`}
        </option>
      </StyledSelect>
    </StyledModeHeader>

    {executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL && (
      <>
        <StyledField>
          <span>{t`Task title`}</span>
          <StyledInput
            value={manualTaskTitle}
            onChange={(event) => onManualTaskTitleChange(event.target.value)}
            placeholder={t`Give the assignee a clear action`}
          />
        </StyledField>
        <StyledField>
          <span>{t`Task description`}</span>
          <StyledTextarea
            value={manualTaskDescription}
            onChange={(event) =>
              onManualTaskDescriptionChange(event.target.value)
            }
            placeholder={t`Add the context needed to complete this step`}
          />
        </StyledField>
      </>
    )}
  </StyledModeSection>
);
