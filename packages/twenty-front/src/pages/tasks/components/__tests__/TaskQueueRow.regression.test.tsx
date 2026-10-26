import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SEQUENCE_TASK_TYPES, TASK_PRIORITIES } from 'twenty-shared/types';
import { type ButtonProps } from 'twenty-ui/input';

import { TaskQueueRow } from '~/pages/tasks/components/TaskQueueRow';
import { type TaskQueueRecord } from '~/pages/tasks/types/TaskQueueRecord';

const mockOpenRecordInSidePanel = jest.fn();
const mockOpenSequenceTimeline = jest.fn();
const mockUpdateOneRecord = jest.fn();

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock('@/side-panel/hooks/useOpenRecordInSidePanel', () => ({
  useOpenRecordInSidePanel: () => ({
    openRecordInSidePanel: mockOpenRecordInSidePanel,
  }),
}));

jest.mock('@/sequence/hooks/useOpenSequenceTimeline', () => ({
  useOpenSequenceTimeline: () => ({
    openSequenceTimeline: mockOpenSequenceTimeline,
  }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));

jest.mock('twenty-ui/input', () => ({
  Checkbox: () => <input aria-label="Complete task" type="checkbox" />,
  CheckboxShape: { Rounded: 'Rounded' },
  Button: ({ title, ariaLabel, disabled, onClick }: ButtonProps) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
}));

type TaskPhones = NonNullable<
  TaskQueueRecord['taskTargets'][number]['targetPerson']
>['phones'];

const createCallTask = (phones: TaskPhones): TaskQueueRecord =>
  ({
    id: 'call-task-id',
    title: 'Call Jane',
    status: 'TODO',
    dueAt: null,
    type: SEQUENCE_TASK_TYPES.CALL,
    priority: TASK_PRIORITIES.MEDIUM,
    sequenceEnrollmentId: 'enrollment-id',
    taskTargets: [
      {
        id: 'task-target-id',
        targetPerson: {
          id: 'person-id',
          phones,
          linkedinLink: null,
        },
      },
    ],
  }) as TaskQueueRecord;

describe('TaskQueueRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it.each<{ description: string; phones: TaskPhones; expectedNumber: string }>([
    {
      description: 'the primary number has a separate country calling code',
      phones: {
        primaryPhoneNumber: '(202) 555-0123',
        primaryPhoneCallingCode: '+1',
        additionalPhones: null,
      },
      expectedNumber: '+12025550123',
    },
    {
      description: 'the primary number already includes its country code',
      phones: {
        primaryPhoneNumber: '+1 (202) 555-0123',
        primaryPhoneCallingCode: '+1',
        additionalPhones: null,
      },
      expectedNumber: '+12025550123',
    },
    {
      description: 'the national number starts with a trunk prefix',
      phones: {
        primaryPhoneNumber: '020 7946 0018',
        primaryPhoneCallingCode: '+44',
        additionalPhones: null,
      },
      expectedNumber: '+442079460018',
    },
    {
      description: 'only an additional number is available',
      phones: {
        primaryPhoneNumber: null,
        primaryPhoneCallingCode: null,
        additionalPhones: [{ number: '2025550123', callingCode: '+1' }],
      },
      expectedNumber: '+12025550123',
    },
    {
      description:
        'additional numbers arrive as JSON and the primary is invalid',
      phones: {
        primaryPhoneNumber: '123',
        primaryPhoneCallingCode: '+1',
        additionalPhones:
          '[null, {"number": 123}, {"number": "+1 202 555 0123", "callingCode": "+1"}]',
      },
      expectedNumber: '+12025550123',
    },
  ])(
    'should open CloudTalk without completing the task when $description',
    async ({ phones, expectedNumber }) => {
      const user = userEvent.setup();
      const openPhone = jest.spyOn(window, 'open').mockReturnValue(null);
      const onCompleted = jest.fn();

      render(
        <TaskQueueRow
          task={createCallTask(phones)}
          onCompleted={onCompleted}
          canUpdate={true}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'Call in CloudTalk' }),
      );

      expect(openPhone).toHaveBeenCalledTimes(1);
      expect(openPhone).toHaveBeenCalledWith(
        `ct+tel:${expectedNumber}`,
        '_self',
      );
      expect(mockOpenRecordInSidePanel).not.toHaveBeenCalled();
      expect(mockOpenSequenceTimeline).toHaveBeenCalledWith({
        taskId: 'call-task-id',
      });
      expect(mockUpdateOneRecord).not.toHaveBeenCalled();
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it.each<TaskPhones>([
    null,
    {
      primaryPhoneNumber: '2025550123',
      primaryPhoneCallingCode: null,
      additionalPhones: 'invalid JSON',
    },
    {
      primaryPhoneNumber: '+12025550123?from=%2B442079460018',
      primaryPhoneCallingCode: '+1',
      additionalPhones: null,
    },
  ])(
    'should disable calling when no usable international number exists (%j)',
    async (phones) => {
      const user = userEvent.setup();
      const openPhone = jest.spyOn(window, 'open').mockReturnValue(null);

      render(
        <TaskQueueRow
          task={createCallTask(phones)}
          onCompleted={jest.fn()}
          canUpdate={true}
        />,
      );

      const callButton = screen.getByRole('button', {
        name: 'Call in CloudTalk',
      });

      expect(callButton).toBeDisabled();
      expect(callButton).toHaveTextContent('No phone number');
      await user.click(callButton);
      expect(openPhone).not.toHaveBeenCalled();
      expect(mockOpenSequenceTimeline).not.toHaveBeenCalled();
      expect(mockOpenRecordInSidePanel).not.toHaveBeenCalled();
    },
  );

  it('should not offer calling for an email task with a phone number', () => {
    const task = createCallTask({
      primaryPhoneNumber: '+12025550123',
      primaryPhoneCallingCode: '+1',
      additionalPhones: null,
    });
    task.type = SEQUENCE_TASK_TYPES.EMAIL;

    render(
      <TaskQueueRow task={task} onCompleted={jest.fn()} canUpdate={true} />,
    );

    expect(
      screen.queryByRole('button', { name: 'Call in CloudTalk' }),
    ).not.toBeInTheDocument();
  });

  it.each(Object.values(SEQUENCE_TASK_TYPES))(
    'should open the prospect timeline for a %s task',
    async (type) => {
      const user = userEvent.setup();
      const task = createCallTask(null);
      task.type = type;

      render(
        <TaskQueueRow task={task} onCompleted={jest.fn()} canUpdate={true} />,
      );

      await user.click(
        screen.getByRole('button', {
          name: 'Open sequence timeline: Call Jane',
        }),
      );

      expect(mockOpenSequenceTimeline).toHaveBeenCalledTimes(1);
      expect(mockOpenSequenceTimeline).toHaveBeenCalledWith({
        taskId: task.id,
      });
      expect(mockUpdateOneRecord).not.toHaveBeenCalled();
    },
  );

  it('should open the timeline with the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <TaskQueueRow
        task={createCallTask(null)}
        onCompleted={jest.fn()}
        canUpdate={true}
      />,
    );
    screen
      .getByRole('button', { name: 'Open sequence timeline: Call Jane' })
      .focus();
    await user.keyboard('{Enter}');
    expect(mockOpenSequenceTimeline).toHaveBeenCalledTimes(1);
  });
});
