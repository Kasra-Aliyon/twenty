import { FormAdvancedTextFieldInput } from '@/object-record/record-field/ui/form-types/components/FormAdvancedTextFieldInput';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { type SequenceEmailStepSettings } from 'twenty-shared/types';
import { Button, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { StyledActions, StyledField, StyledInput } from './SequencePageStyles';
import { SequenceVariablePicker } from './SequenceVariablePicker';

const StyledEditor = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

const StyledFieldHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledToggleRow = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  height: 32px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

type SequenceEmailStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceEmailStepSettings;
  disabled: boolean;
};

export const SequenceEmailStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceEmailStepEditorProps) => {
  const [subject, setSubject] = useState(settings.subject);
  const [bodyHtml, setBodyHtml] = useState(settings.bodyHtml);
  const [bodyEditorVersion, setBodyEditorVersion] = useState(0);
  const [threadAsReplyToPreviousEmail, setThreadAsReplyToPreviousEmail] =
    useState(settings.threadAsReplyToPreviousEmail);
  const [stopOnReply, setStopOnReply] = useState<boolean | null>(
    settings.stopOnReply,
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
            type: 'SEND_EMAIL',
            subject,
            bodyHtml,
            threadAsReplyToPreviousEmail,
            stopOnReply,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Email step saved.` });
    } catch {
      enqueueErrorSnackBar({ message: t`The email step could not be saved.` });
    } finally {
      setIsSaving(false);
    }
  };

  const appendVariableToBody = (variableName: string) => {
    setBodyHtml((currentBody) => `${currentBody}{{ ${variableName} }}`);
    setBodyEditorVersion((version) => version + 1);
  };

  return (
    <StyledEditor>
      <StyledField>
        <StyledFieldHeader>
          <span>{t`Subject`}</span>
          <SequenceVariablePicker
            dropdownId={`sequence-subject-variable-${step.id}`}
            onVariableSelect={(variableName) =>
              setSubject(
                (currentSubject) => `${currentSubject}{{ ${variableName} }}`,
              )
            }
          />
        </StyledFieldHeader>
        <StyledInput
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={t`A quick question for {{ firstName }}`}
        />
      </StyledField>

      <div>
        <StyledFieldHeader>
          <span>{t`Email body`}</span>
          <SequenceVariablePicker
            dropdownId={`sequence-body-variable-${step.id}`}
            onVariableSelect={appendVariableToBody}
          />
        </StyledFieldHeader>
        <FormAdvancedTextFieldInput
          key={bodyEditorVersion}
          defaultValue={bodyHtml}
          onChange={setBodyHtml}
          placeholder={t`Write the email sent at this step`}
          minHeight={180}
          maxWidth={800}
          contentType="html"
        />
      </div>

      <StyledToggleRow>
        <span>{t`Thread as a reply to the previous sequence email`}</span>
        <Toggle
          value={threadAsReplyToPreviousEmail}
          onChange={setThreadAsReplyToPreviousEmail}
          toggleSize="small"
        />
      </StyledToggleRow>

      <StyledField>
        <span>{t`Stop on reply`}</span>
        <StyledSelect
          value={stopOnReply === null ? 'INHERIT' : String(stopOnReply)}
          onChange={(event) =>
            setStopOnReply(
              event.target.value === 'INHERIT'
                ? null
                : event.target.value === 'true',
            )
          }
        >
          <option value="INHERIT">{t`Use sequence setting`}</option>
          <option value="true">{t`Always stop`}</option>
          <option value="false">{t`Do not stop`}</option>
        </StyledSelect>
      </StyledField>

      <StyledActions>
        <Button
          title={t`Save email step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={disabled}
        />
      </StyledActions>
    </StyledEditor>
  );
};
