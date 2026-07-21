import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  CoreObjectNameSingular,
  SEQUENCE_TASK_TYPES,
} from 'twenty-shared/types';
import { IconBrandLinkedin, IconCalendar, IconSend } from 'twenty-ui/icon';
import { Checkbox, CheckboxShape } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { beautifyExactDateTime } from '~/utils/date-utils';

import { type TaskQueueRecord } from '../types/TaskQueueRecord';

const StyledRow = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  cursor: pointer;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  min-height: 48px;
  padding: 0 ${themeCssVariables.spacing[3]};

  &:hover {
    background: ${themeCssVariables.background.transparent.lighter};
  }
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-weight: ${themeCssVariables.font.weight.medium};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledMeta = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledTag = styled.span`
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.pill};
  padding: ${themeCssVariables.spacing['0.5']} ${themeCssVariables.spacing[1]};
`;

const StyledLinkedinLink = styled.a`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: inline-flex;
  gap: ${themeCssVariables.spacing[1]};
  text-decoration: none;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
    text-decoration: underline;
  }
`;

type TaskQueueRowProps = {
  task: TaskQueueRecord;
  onCompleted: () => Promise<void>;
  canUpdate: boolean;
};

export const TaskQueueRow = ({
  task,
  onCompleted,
  canUpdate,
}: TaskQueueRowProps) => {
  const { updateOneRecord } = useUpdateOneRecord();
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const { enqueueErrorSnackBar } = useSnackBar();
  const linkedinUrl = task.taskTargets?.find(
    (taskTarget) => taskTarget.targetPerson?.linkedinLink?.primaryLinkUrl,
  )?.targetPerson?.linkedinLink?.primaryLinkUrl;
  const isLinkedinTask =
    task.type === SEQUENCE_TASK_TYPES.LINKEDIN_CONNECTION ||
    task.type === SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE;

  const completeTask = async (isCompleted: boolean) => {
    if (!canUpdate) {
      return;
    }

    try {
      await updateOneRecord<TaskQueueRecord>({
        objectNameSingular: CoreObjectNameSingular.Task,
        idToUpdate: task.id,
        updateOneRecordInput: {
          status: isCompleted ? 'DONE' : 'TODO',
        },
      });
      await onCompleted();
    } catch {
      enqueueErrorSnackBar({ message: t`The task could not be completed.` });
    }
  };

  return (
    <StyledRow
      onClick={() =>
        openRecordInSidePanel({
          recordId: task.id,
          objectNameSingular: CoreObjectNameSingular.Task,
        })
      }
    >
      <div onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={task.status === 'DONE'}
          shape={CheckboxShape.Rounded}
          onCheckedChange={(isCompleted) => void completeTask(isCompleted)}
          disabled={!canUpdate}
        />
      </div>
      {task.sequenceEnrollmentId && <IconSend size={16} />}
      <StyledTitle>{task.title || t`Untitled task`}</StyledTitle>
      <StyledMeta>
        {isLinkedinTask && linkedinUrl && (
          <StyledLinkedinLink
            href={linkedinUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            <IconBrandLinkedin size={14} />
            {t`Open in LinkedIn`}
          </StyledLinkedinLink>
        )}
        {task.type && <StyledTag>{task.type}</StyledTag>}
        {task.priority && <StyledTag>{task.priority}</StyledTag>}
        {task.dueAt && (
          <span>
            <IconCalendar size={14} /> {beautifyExactDateTime(task.dueAt)}
          </span>
        )}
      </StyledMeta>
    </StyledRow>
  );
};
