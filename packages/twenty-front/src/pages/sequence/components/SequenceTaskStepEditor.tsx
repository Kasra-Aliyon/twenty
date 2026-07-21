import { currentWorkspaceMembersState } from '@/auth/states/currentWorkspaceMembersState';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
  type SequenceCreateTaskStepSettings,
  type SequenceTaskContinueMode,
  type SequenceTaskType,
  type TaskPriority,
} from 'twenty-shared/types';
import { Button, type SelectOption } from 'twenty-ui/input';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import {
  StyledActions,
  StyledFieldsGrid,
  StyledField,
  StyledInput,
  StyledTextarea,
} from './SequencePageStyles';

const TASK_TYPE_OPTIONS: SelectOption<SequenceTaskType>[] = [
  { value: SEQUENCE_TASK_TYPES.CALL, label: t`Call` },
  { value: SEQUENCE_TASK_TYPES.TODO, label: t`To do` },
  {
    value: SEQUENCE_TASK_TYPES.LINKEDIN_CONNECTION,
    label: t`LinkedIn connection`,
  },
  {
    value: SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE,
    label: t`LinkedIn message`,
  },
  { value: SEQUENCE_TASK_TYPES.EMAIL, label: t`Manual email` },
  { value: SEQUENCE_TASK_TYPES.CUSTOM, label: t`Custom` },
];

const PRIORITY_OPTIONS: SelectOption<TaskPriority>[] = [
  { value: TASK_PRIORITIES.LOW, label: t`Low` },
  { value: TASK_PRIORITIES.MEDIUM, label: t`Medium` },
  { value: TASK_PRIORITIES.HIGH, label: t`High` },
  { value: TASK_PRIORITIES.URGENT, label: t`Urgent` },
];

const CONTINUE_MODE_OPTIONS: SelectOption<SequenceTaskContinueMode>[] = [
  { value: 'ON_DONE', label: t`When the task is completed` },
  { value: 'ON_DEADLINE', label: t`When completed or the deadline passes` },
  { value: 'IMMEDIATE', label: t`Immediately` },
];

type SequenceTaskStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceCreateTaskStepSettings;
  disabled: boolean;
};

export const SequenceTaskStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceTaskStepEditorProps) => {
  const currentWorkspaceMembers = useAtomStateValue(
    currentWorkspaceMembersState,
  );
  const [taskType, setTaskType] = useState(settings.taskType);
  const [titleTemplate, setTitleTemplate] = useState(settings.titleTemplate);
  const [notesTemplate, setNotesTemplate] = useState(settings.notesTemplate);
  const [priority, setPriority] = useState(settings.priority);
  const [assigneeWorkspaceMemberId, setAssigneeWorkspaceMemberId] = useState(
    settings.assigneeWorkspaceMemberId ?? '',
  );
  const [continueMode, setContinueMode] = useState(settings.continueMode);
  const [deadlineDays, setDeadlineDays] = useState(settings.deadlineDays ?? 1);
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const assigneeOptions: SelectOption<string>[] = [
    { value: '', label: t`Enrollment owner` },
    ...currentWorkspaceMembers.map((member) => ({
      value: member.id,
      label:
        `${member.name.firstName} ${member.name.lastName}`.trim() ||
        member.userEmail,
    })),
  ];

  const save = async () => {
    setIsSaving(true);

    try {
      await updateOneRecord<SequenceStepRecord>({
        objectNameSingular: 'sequenceStep',
        idToUpdate: step.id,
        updateOneRecordInput: {
          settings: {
            type: 'CREATE_TASK',
            taskType,
            titleTemplate,
            notesTemplate,
            priority,
            assigneeWorkspaceMemberId: assigneeWorkspaceMemberId || null,
            continueMode,
            deadlineDays: continueMode === 'ON_DEADLINE' ? deadlineDays : null,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Task step saved.` });
    } catch {
      enqueueErrorSnackBar({ message: t`The task step could not be saved.` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <StyledFieldsGrid>
        <Select
          dropdownId={`sequence-task-type-${step.id}`}
          label={t`Task type`}
          fullWidth
          value={taskType}
          options={TASK_TYPE_OPTIONS}
          onChange={setTaskType}
        />
        <Select
          dropdownId={`sequence-task-priority-${step.id}`}
          label={t`Priority`}
          fullWidth
          value={priority}
          options={PRIORITY_OPTIONS}
          onChange={setPriority}
        />
        <Select
          dropdownId={`sequence-task-assignee-${step.id}`}
          label={t`Assignee`}
          fullWidth
          value={assigneeWorkspaceMemberId}
          options={assigneeOptions}
          onChange={setAssigneeWorkspaceMemberId}
        />
        <Select
          dropdownId={`sequence-task-continue-${step.id}`}
          label={t`Continue sequence`}
          fullWidth
          value={continueMode}
          options={CONTINUE_MODE_OPTIONS}
          onChange={setContinueMode}
        />
      </StyledFieldsGrid>

      <StyledField>
        <span>{t`Task title`}</span>
        <StyledInput
          value={titleTemplate}
          onChange={(event) => setTitleTemplate(event.target.value)}
          placeholder={t`Call {{ fullName }}`}
        />
      </StyledField>

      <StyledField>
        <span>{t`Notes`}</span>
        <StyledTextarea
          value={notesTemplate}
          onChange={(event) => setNotesTemplate(event.target.value)}
          placeholder={t`Add context for the assignee`}
        />
      </StyledField>

      {continueMode === 'ON_DEADLINE' && (
        <StyledField>
          <span>{t`Deadline in days`}</span>
          <StyledInput
            type="number"
            min={0}
            value={deadlineDays}
            onChange={(event) =>
              setDeadlineDays(Math.max(0, Number(event.target.value) || 0))
            }
          />
        </StyledField>
      )}

      <StyledActions>
        <Button
          title={t`Save task step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={disabled}
        />
      </StyledActions>
    </>
  );
};
