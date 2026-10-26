import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useRef, useState } from 'react';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { v4 } from 'uuid';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import {
  CALL_OUTCOMES,
  getCallOutcomeLabel,
  getManualSequenceActivityLabel,
  MANUAL_SEQUENCE_ACTIVITIES,
  type CallOutcome,
  type ManualSequenceActivity,
} from '@/sequence/utils/sequenceActivity';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

const StyledForm = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font: inherit;
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledNotes = styled.textarea`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font: inherit;
  min-height: 72px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

type SequenceActivityFormProps = {
  personId: string;
  taskId?: string;
  sequenceEnrollmentId?: string;
  isCallTask: boolean;
  canRecord: boolean;
  onSaved: () => Promise<unknown>;
};

export const SequenceActivityForm = ({
  personId,
  taskId,
  sequenceEnrollmentId,
  isCallTask,
  canRecord,
  onSaved,
}: SequenceActivityFormProps) => {
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [activity, setActivity] = useState<ManualSequenceActivity | ''>('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [recordId, setRecordId] = useState(() => v4());
  // Guard duplicate submissions synchronously; isSaving controls rendering.
  // oxlint-disable-next-line twenty/no-state-useref
  const savingRef = useRef(false);
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();
  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular: CoreObjectNameSingular.TimelineActivity,
  });
  const permissions = useObjectPermissionsForObject(objectMetadataItem.id);
  const { createOneRecord } = useCreateOneRecord({
    objectNameSingular: CoreObjectNameSingular.TimelineActivity,
    recordGqlFields: { id: true },
    skipPostOptimisticEffect: true,
  });
  const canSave =
    canRecord &&
    permissions.canUpdateObjectRecords &&
    !!currentWorkspaceMember?.id;

  const saveActivity = async () => {
    if (!canSave || savingRef.current || !(isCallTask ? outcome : activity)) {
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    // Reuse the ID after an uncertain response to avoid duplicate attempts.

    try {
      await createOneRecord({
        id: recordId,
        name: isCallTask
          ? 'sequence.call-recorded'
          : 'sequence.activity-recorded',
        happensAt: new Date().toISOString(),
        targetPersonId: personId,
        workspaceMemberId: currentWorkspaceMember?.id,
        properties: {
          source: 'manual',
          ...(isCallTask ? { outcome } : { activity }),
          notes: notes.trim(),
          ...(taskId ? { taskId } : {}),
          ...(sequenceEnrollmentId ? { sequenceEnrollmentId } : {}),
        },
      });
      setRecordId(v4());
      setOutcome('');
      setActivity('');
      setNotes('');
      enqueueSuccessSnackBar({ message: t`Activity recorded.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The activity could not be saved. Your notes have been kept. Refresh the timeline before retrying if the connection was interrupted.`,
      });
      return;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }

    await onSaved().catch(() =>
      enqueueErrorSnackBar({
        message: t`Activity saved. Refresh to load the timeline.`,
      }),
    );
  };

  return (
    <StyledForm>
      <StyledLabel>
        {isCallTask ? t`Call result` : t`Log a completed activity`}
        <StyledSelect
          value={isCallTask ? outcome : activity}
          disabled={!canSave || isSaving}
          onChange={(event) => {
            if (isCallTask) {
              setOutcome(event.target.value as CallOutcome | '');
            } else {
              setActivity(event.target.value as ManualSequenceActivity | '');
            }
          }}
        >
          <option value="">{t`Choose a result`}</option>
          {isCallTask
            ? CALL_OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {getCallOutcomeLabel(value)}
                </option>
              ))
            : MANUAL_SEQUENCE_ACTIVITIES.map((value) => (
                <option key={value} value={value}>
                  {getManualSequenceActivityLabel(value)}
                </option>
              ))}
        </StyledSelect>
      </StyledLabel>
      <StyledLabel>
        {t`Notes (optional)`}
        <StyledNotes
          value={notes}
          maxLength={2000}
          disabled={!canSave || isSaving}
          placeholder={t`What happened? Add context for the next touchpoint.`}
          onChange={(event) => setNotes(event.target.value)}
        />
      </StyledLabel>
      <StyledHint>
        {canSave
          ? t`Records history only. Does not send a follow-up, complete the task, or change the sequence.`
          : t`You do not have permission to record activity.`}
      </StyledHint>
      <Button
        title={isCallTask ? t`Save call result` : t`Save activity`}
        variant="primary"
        size="small"
        disabled={!canSave || isSaving || !(isCallTask ? outcome : activity)}
        isLoading={isSaving}
        onClick={() => void saveActivity()}
      />
    </StyledForm>
  );
};
