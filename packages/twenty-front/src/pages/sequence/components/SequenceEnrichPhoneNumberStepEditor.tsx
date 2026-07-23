import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  type SequenceEnrichPhoneNumberStepSettings,
} from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { SequenceExecutionModeFields } from './SequenceExecutionModeFields';
import { StyledActions } from './SequencePageStyles';

const StyledDescription = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.5;
  margin: 0;
`;

type SequenceEnrichPhoneNumberStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceEnrichPhoneNumberStepSettings;
  disabled: boolean;
};

export const SequenceEnrichPhoneNumberStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceEnrichPhoneNumberStepEditorProps) => {
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

  const save = async () => {
    setIsSaving(true);

    try {
      await updateOneRecord<SequenceStepRecord>({
        objectNameSingular: 'sequenceStep',
        idToUpdate: step.id,
        updateOneRecordInput: {
          settings: {
            type: 'ENRICH_PHONE_NUMBER',
            branch: settings.branch,
            executionMode,
            manualTaskTitle,
            manualTaskDescription,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Phone enrichment step saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The phone enrichment step could not be saved.`,
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
      <StyledDescription>
        {executionMode === SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED
          ? t`Apollo enriches contacts that do not already have a phone number. The sequence records an error when enrichment is disabled or no number is found.`
          : t`A task is created for the sequence assignee to find and add the phone number.`}
      </StyledDescription>
      <StyledActions>
        <Button
          title={t`Save phone enrichment step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={
            disabled ||
            (executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL &&
              manualTaskTitle.trim().length === 0)
          }
        />
      </StyledActions>
    </>
  );
};
