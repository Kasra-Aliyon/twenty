import { Select } from '@/ui/input/components/Select';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
  type SequenceTaskType,
  type TaskPriority,
} from 'twenty-shared/types';
import { type SelectOption } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export type TaskTypeFilter = SequenceTaskType | 'ALL';
export type TaskPriorityFilter = TaskPriority | 'ALL';

const TYPE_OPTIONS: SelectOption<TaskTypeFilter>[] = [
  { value: 'ALL', label: t`All task types` },
  { value: SEQUENCE_TASK_TYPES.CALL, label: t`Calls` },
  { value: SEQUENCE_TASK_TYPES.TODO, label: t`To dos` },
  {
    value: SEQUENCE_TASK_TYPES.LINKEDIN_CONNECTION,
    label: t`LinkedIn connections`,
  },
  {
    value: SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE,
    label: t`LinkedIn messages`,
  },
  { value: SEQUENCE_TASK_TYPES.EMAIL, label: t`Manual emails` },
  { value: SEQUENCE_TASK_TYPES.CUSTOM, label: t`Custom tasks` },
];

const PRIORITY_OPTIONS: SelectOption<TaskPriorityFilter>[] = [
  { value: 'ALL', label: t`All priorities` },
  { value: TASK_PRIORITIES.URGENT, label: t`Urgent` },
  { value: TASK_PRIORITIES.HIGH, label: t`High` },
  { value: TASK_PRIORITIES.MEDIUM, label: t`Medium` },
  { value: TASK_PRIORITIES.LOW, label: t`Low` },
];

const StyledFilters = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[4]};
`;

type TaskQueueFiltersProps = {
  typeFilter: TaskTypeFilter;
  priorityFilter: TaskPriorityFilter;
  onTypeFilterChange: (value: TaskTypeFilter) => void;
  onPriorityFilterChange: (value: TaskPriorityFilter) => void;
};

export const TaskQueueFilters = ({
  typeFilter,
  priorityFilter,
  onTypeFilterChange,
  onPriorityFilterChange,
}: TaskQueueFiltersProps) => (
  <StyledFilters>
    <Select
      dropdownId="task-queue-type-filter"
      selectSizeVariant="small"
      value={typeFilter}
      options={TYPE_OPTIONS}
      onChange={onTypeFilterChange}
    />
    <Select
      dropdownId="task-queue-priority-filter"
      selectSizeVariant="small"
      value={priorityFilter}
      options={PRIORITY_OPTIONS}
      onChange={onPriorityFilterChange}
    />
  </StyledFilters>
);
