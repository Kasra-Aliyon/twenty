import { fireEvent, render, screen } from '@testing-library/react';
import { TASK_PRIORITIES } from 'twenty-shared/types';

import {
  TASK_CATEGORY_FILTERS,
  TaskQueueFilters,
} from '~/pages/tasks/components/TaskQueueFilters';

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    dropdownId,
    value,
    options,
    onChange,
  }: {
    dropdownId: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={dropdownId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('TaskQueueFilters', () => {
  it('offers task categories and changes the selected category', () => {
    const onCategoryFilterChange = jest.fn();

    render(
      <TaskQueueFilters
        categoryFilter={TASK_CATEGORY_FILTERS.ALL}
        priorityFilter={TASK_PRIORITIES.MEDIUM}
        onCategoryFilterChange={onCategoryFilterChange}
        onPriorityFilterChange={jest.fn()}
      />,
    );

    const categoryFilter = screen.getByRole('combobox', {
      name: 'task-queue-category-filter',
    });

    expect(categoryFilter).toHaveTextContent('All categories');
    expect(categoryFilter).toHaveTextContent('LinkedIn');
    expect(categoryFilter).toHaveTextContent('Calls');
    expect(categoryFilter).toHaveTextContent('Emails');
    expect(categoryFilter).toHaveTextContent('To-dos');
    expect(categoryFilter).toHaveTextContent('Custom');

    fireEvent.change(categoryFilter, {
      target: { value: TASK_CATEGORY_FILTERS.LINKEDIN },
    });

    expect(onCategoryFilterChange).toHaveBeenCalledWith(
      TASK_CATEGORY_FILTERS.LINKEDIN,
    );
  });
});
