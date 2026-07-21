import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { type SequenceConnectionRequestStepSettings } from 'twenty-shared/types';
import { Button, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import {
  StyledActions,
  StyledField,
  StyledTextarea,
} from './SequencePageStyles';
import { SequenceVariablePicker } from './SequenceVariablePicker';

const LINKEDIN_NOTE_CHARACTER_LIMIT = 200;

const StyledFieldHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledHint = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledCharacterCount = styled.span<{ isOverLimit: boolean }>`
  color: ${({ isOverLimit }) =>
    isOverLimit
      ? themeCssVariables.font.color.danger
      : themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  text-align: right;
`;

const StyledToggleRow = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

type SequenceConnectionRequestStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceConnectionRequestStepSettings;
  disabled: boolean;
};

export const SequenceConnectionRequestStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceConnectionRequestStepEditorProps) => {
  const [noteTemplate, setNoteTemplate] = useState(settings.noteTemplate);
  const [skipIfAlreadyConnected, setSkipIfAlreadyConnected] = useState(
    settings.skipIfAlreadyConnected,
  );
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const save = async () => {
    setIsSaving(true);

    try {
      await updateOneRecord<SequenceStepRecord>({
        objectNameSingular: 'sequenceStep',
        idToUpdate: step.id,
        updateOneRecordInput: {
          settings: {
            type: 'SEND_CONNECTION_REQUEST',
            noteTemplate,
            skipIfAlreadyConnected,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Connection request step saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The connection request step could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <StyledField>
        <StyledFieldHeader>
          <span>{t`Invitation note`}</span>
          <SequenceVariablePicker
            dropdownId={`sequence-linkedin-note-variable-${step.id}`}
            onVariableSelect={(variableName) =>
              setNoteTemplate(
                (currentNote) => `${currentNote}{{ ${variableName} }}`,
              )
            }
          />
        </StyledFieldHeader>
        <StyledTextarea
          value={noteTemplate}
          onChange={(event) => setNoteTemplate(event.target.value)}
          placeholder={t`Hi {{ firstName }}, I'd like to connect.`}
        />
        <StyledCharacterCount
          isOverLimit={noteTemplate.length > LINKEDIN_NOTE_CHARACTER_LIMIT}
        >
          {noteTemplate.length}/{LINKEDIN_NOTE_CHARACTER_LIMIT}
        </StyledCharacterCount>
        <StyledHint>
          {noteTemplate.length === 0
            ? t`No note sends a standard invitation. LinkedIn limits free accounts to three personalized invitations per month.`
            : t`Variables are rendered before sending; notes longer than 200 characters are truncated by the server.`}
        </StyledHint>
      </StyledField>

      <StyledToggleRow>
        <span>{t`Skip when already connected or an invitation is pending`}</span>
        <Toggle
          value={skipIfAlreadyConnected}
          onChange={setSkipIfAlreadyConnected}
          toggleSize="small"
        />
      </StyledToggleRow>

      <StyledActions>
        <Button
          title={t`Save connection request step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={disabled}
        />
      </StyledActions>
    </>
  );
};
