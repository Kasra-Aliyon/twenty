import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { isBefore, isToday, parseISO, startOfDay } from 'date-fns';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type TaskQueueRecord } from '../types/TaskQueueRecord';
import { TaskQueueRow } from './TaskQueueRow';

const StyledList = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: auto;
`;

const StyledGroup = styled.section`
  display: flex;
  flex-direction: column;
`;

const StyledGroupTitle = styled.h2`
  background: ${themeCssVariables.background.secondary};
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  position: sticky;
  top: 0;
  z-index: 1;
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  padding: ${themeCssVariables.spacing[6]};
`;

type TaskQueueListProps = {
  tasks: TaskQueueRecord[];
  onTaskCompleted: () => Promise<void>;
  canUpdateTasks: boolean;
};

export const TaskQueueList = ({
  tasks,
  onTaskCompleted,
  canUpdateTasks,
}: TaskQueueListProps) => {
  const today = startOfDay(new Date());
  const groups = [
    {
      id: 'overdue',
      title: t`Overdue`,
      tasks: tasks.filter(
        (task) => task.dueAt !== null && isBefore(parseISO(task.dueAt), today),
      ),
    },
    {
      id: 'today',
      title: t`Today`,
      tasks: tasks.filter(
        (task) => task.dueAt !== null && isToday(parseISO(task.dueAt)),
      ),
    },
    {
      id: 'upcoming',
      title: t`Upcoming`,
      tasks: tasks.filter(
        (task) =>
          task.dueAt !== null &&
          !isBefore(parseISO(task.dueAt), today) &&
          !isToday(parseISO(task.dueAt)),
      ),
    },
    {
      id: 'no-date',
      title: t`No date`,
      tasks: tasks.filter((task) => task.dueAt === null),
    },
  ];

  if (tasks.length === 0) {
    return <StyledEmpty>{t`No open tasks match these filters.`}</StyledEmpty>;
  }

  return (
    <StyledList>
      {groups
        .filter((group) => group.tasks.length > 0)
        .map((group) => (
          <StyledGroup key={group.id}>
            <StyledGroupTitle>
              {group.title} ({group.tasks.length})
            </StyledGroupTitle>
            {group.tasks.map((task) => (
              <TaskQueueRow
                key={task.id}
                task={task}
                onCompleted={onTaskCompleted}
                canUpdate={canUpdateTasks}
              />
            ))}
          </StyledGroup>
        ))}
    </StyledList>
  );
};
