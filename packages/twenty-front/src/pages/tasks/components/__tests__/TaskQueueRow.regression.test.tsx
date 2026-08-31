import { fireEvent, render, screen } from '@testing-library/react';
import { SEQUENCE_TASK_TYPES, TASK_PRIORITIES } from 'twenty-shared/types';

import { TaskQueueRow } from '~/pages/tasks/components/TaskQueueRow';
import { type TaskQueueRecord } from '~/pages/tasks/types/TaskQueueRecord';

const mockOpenRecordInSidePanel = jest.fn();

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: jest.fn() }),
}));

jest.mock('@/side-panel/hooks/useOpenRecordInSidePanel', () => ({
  useOpenRecordInSidePanel: () => ({
    openRecordInSidePanel: mockOpenRecordInSidePanel,
  }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));

jest.mock('twenty-ui/input', () => ({
  Checkbox: () => <input aria-label="Complete task" type="checkbox" />,
  CheckboxShape: { Rounded: 'Rounded' },
}));

describe('TaskQueueRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a direct LinkedIn profile link for a sequence todo task', () => {
    const task = {
      id: 'task-id',
      title: '[LinkedIn 1/5] Review and follow Wendy',
      status: 'TODO',
      dueAt: null,
      type: SEQUENCE_TASK_TYPES.TODO,
      priority: TASK_PRIORITIES.MEDIUM,
      sequenceEnrollmentId: 'enrollment-id',
      taskTargets: [
        {
          id: 'task-target-id',
          targetPerson: {
            id: 'person-id',
            linkedinLink: {
              primaryLinkUrl: 'https://www.linkedin.com/in/wendy-example',
            },
          },
        },
      ],
    } as TaskQueueRecord;

    render(
      <TaskQueueRow task={task} onCompleted={jest.fn()} canUpdate={true} />,
    );

    const linkedinLink = screen.getByRole('link', {
      name: 'Open in LinkedIn',
    });

    expect(linkedinLink).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/wendy-example',
    );
    expect(linkedinLink).toHaveAttribute('target', '_blank');

    fireEvent.click(linkedinLink);

    expect(mockOpenRecordInSidePanel).not.toHaveBeenCalled();
  });
});
