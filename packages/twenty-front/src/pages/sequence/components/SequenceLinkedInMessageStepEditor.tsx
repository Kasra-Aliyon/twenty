import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  type SequenceLinkedInMessageStepSettings,
} from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import {
  StyledActions,
  StyledField,
  StyledTextarea,
} from './SequencePageStyles';
import { SequenceExecutionModeFields } from './SequenceExecutionModeFields';
import { SequenceVariablePicker } from './SequenceVariablePicker';

const LINKEDIN_MESSAGE_CHARACTER_LIMIT = 2000;

const StyledFieldHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledCharacterCount = styled.span<{ isOverLimit: boolean }>`
  color: ${({ isOverLimit }) =>
    isOverLimit
      ? themeCssVariables.font.color.danger
      : themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  text-align: right;
`;

const StyledHint = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

type SequenceLinkedInMessageStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceLinkedInMessageStepSettings;
  disabled: boolean;
};

export const SequenceLinkedInMessageStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceLinkedInMessageStepEditorProps) => {
  const [messageTemplate, setMessageTemplate] = useState(
    settings.messageTemplate,
  );
  const [executionMode, setExecutionMode] = useState(
    settings.executionMode ?? SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
  );
  const [manualTaskTitle, setManualTaskTitle] = useState(
    settings.manualTaskTitle ?? '',
  );
  const [manualTaskDescription, setManualTaskDescription] = useState(
    settings.manualTaskDescription ?? '',
  );
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const isInvalid =
    messageTemplate.trim().length === 0 ||
    messageTemplate.length > LINKEDIN_MESSAGE_CHARACTER_LIMIT;

  const save = async () => {
    if (isInvalid) {
      enqueueErrorSnackBar({
        message: t`Enter a LinkedIn message between 1 and 2000 characters.`,
      });
      return;
    }

    setIsSaving(true);

    try {
      await updateOneRecord<SequenceStepRecord>({
        objectNameSingular: 'sequenceStep',
        idToUpdate: step.id,
        updateOneRecordInput: {
          settings: {
            type: 'SEND_LINKEDIN_MESSAGE',
            branch: settings.branch,
            messageTemplate,
            executionMode,
            manualTaskTitle,
            manualTaskDescription,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`LinkedIn message step saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The LinkedIn message step could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <SequenceExecutionModeFields
        executionMode={executionMode}
        manualTaskTitle={manualTaskTitle}
        manualTaskDescription={manualTaskDescription}
        onExecutionModeChange={setExecutionMode}
        onManualTaskTitleChange={setManualTaskTitle}
        onManualTaskDescriptionChange={setManualTaskDescription}
      />

      <StyledField>
        <StyledFieldHeader>
          <span>{t`Direct message`}</span>
          <SequenceVariablePicker
            dropdownId={`sequence-linkedin-message-variable-${step.id}`}
            onVariableSelect={(variableName) =>
              setMessageTemplate(
                (currentMessage) => `${currentMessage}{{ ${variableName} }}`,
              )
            }
          />
        </StyledFieldHeader>
        <StyledTextarea
          value={messageTemplate}
          onChange={(event) => setMessageTemplate(event.target.value)}
          placeholder={t`Hi {{ firstName }}, thanks for connecting.`}
        />
        <StyledCharacterCount
          isOverLimit={
            messageTemplate.length > LINKEDIN_MESSAGE_CHARACTER_LIMIT
          }
        >
          {messageTemplate.length}/{LINKEDIN_MESSAGE_CHARACTER_LIMIT}
        </StyledCharacterCount>
        <StyledHint>
          {t`Sent only when the runner recognizes a first-degree connection. Daily limits, the 15-minute interval, and restriction cooldowns apply.`}
        </StyledHint>
      </StyledField>

      <StyledActions>
        <Button
          title={t`Save LinkedIn message step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={
            disabled ||
            isInvalid ||
            (executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL &&
              manualTaskTitle.trim().length === 0)
          }
        />
      </StyledActions>
    </>
  );
};
