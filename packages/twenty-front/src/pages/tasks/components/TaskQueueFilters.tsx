import { Select } from '@/ui/input/components/Select';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
  type TaskPriority,
} from 'twenty-shared/types';
import { type SelectOption } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const TASK_CATEGORY_FILTERS = {
  ALL: 'ALL',
  LINKEDIN: 'LINKEDIN',
  CALL: SEQUENCE_TASK_TYPES.CALL,
  EMAIL: SEQUENCE_TASK_TYPES.EMAIL,
  TODO: SEQUENCE_TASK_TYPES.TODO,
  CUSTOM: SEQUENCE_TASK_TYPES.CUSTOM,
} as const;

export type TaskCategoryFilter =
  (typeof TASK_CATEGORY_FILTERS)[keyof typeof TASK_CATEGORY_FILTERS];
export type TaskPriorityFilter = TaskPriority | 'ALL';

const CATEGORY_OPTIONS: SelectOption<TaskCategoryFilter>[] = [
  { value: TASK_CATEGORY_FILTERS.ALL, label: t`All categories` },
  {
    value: TASK_CATEGORY_FILTERS.LINKEDIN,
    label: t`LinkedIn`,
  },
  { value: TASK_CATEGORY_FILTERS.CALL, label: t`Calls` },
  { value: TASK_CATEGORY_FILTERS.EMAIL, label: t`Emails` },
  { value: TASK_CATEGORY_FILTERS.TODO, label: t`To-dos` },
  { value: TASK_CATEGORY_FILTERS.CUSTOM, label: t`Custom` },
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
  categoryFilter: TaskCategoryFilter;
  priorityFilter: TaskPriorityFilter;
  onCategoryFilterChange: (value: TaskCategoryFilter) => void;
  onPriorityFilterChange: (value: TaskPriorityFilter) => void;
};

export const TaskQueueFilters = ({
  categoryFilter,
  priorityFilter,
  onCategoryFilterChange,
  onPriorityFilterChange,
}: TaskQueueFiltersProps) => (
  <StyledFilters>
    <Select
      dropdownId="task-queue-category-filter"
      selectSizeVariant="small"
      value={categoryFilter}
      options={CATEGORY_OPTIONS}
      onChange={onCategoryFilterChange}
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
