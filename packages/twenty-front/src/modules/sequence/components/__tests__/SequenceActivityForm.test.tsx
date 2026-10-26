import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ButtonProps } from 'twenty-ui/input';

import { SequenceActivityForm } from '@/sequence/components/SequenceActivityForm';

const mockCreateOneRecord = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
const mockSaved = jest.fn();
let mockCanUpdate = true;

jest.mock('@/object-record/hooks/useCreateOneRecord', () => ({
  useCreateOneRecord: () => ({ createOneRecord: mockCreateOneRecord }),
}));
jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({ objectMetadataItem: { id: 'timeline' } }),
}));
jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({
    canUpdateObjectRecords: mockCanUpdate,
  }),
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => ({ id: 'member-id' }),
}));
jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: mockSuccess,
    enqueueErrorSnackBar: mockError,
  }),
}));
jest.mock('twenty-ui/input', () => ({
  Button: ({ title, disabled, onClick }: ButtonProps) => (
    <button disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
}));

const renderForm = (isCallTask = true, canRecord = true) =>
  render(
    <SequenceActivityForm
      personId="person-id"
      taskId="task-id"
      sequenceEnrollmentId="enrollment-id"
      isCallTask={isCallTask}
      canRecord={canRecord}
      onSaved={mockSaved}
    />,
  );

describe('SequenceActivityForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanUpdate = true;
    mockCreateOneRecord.mockResolvedValue({ id: 'activity-id' });
    mockSaved.mockResolvedValue(undefined);
  });

  it('should record a call outcome and notes against only the selected prospect without completing the task', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(
      screen.getByRole('button', { name: 'Save call result' }),
    ).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText('Call result'),
      'EMAIL_FOLLOW_UP',
    );
    await user.type(
      screen.getByLabelText('Notes (optional)'),
      '  Asked for the overview  ',
    );
    await user.click(screen.getByRole('button', { name: 'Save call result' }));
    await waitFor(() => expect(mockSaved).toHaveBeenCalledTimes(1));

    expect(mockCreateOneRecord).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'sequence.call-recorded',
      happensAt: expect.any(String),
      targetPersonId: 'person-id',
      workspaceMemberId: 'member-id',
      properties: {
        source: 'manual',
        outcome: 'EMAIL_FOLLOW_UP',
        notes: 'Asked for the overview',
        taskId: 'task-id',
        sequenceEnrollmentId: 'enrollment-id',
      },
    });
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('');
    expect(
      screen.getByText(/Does not send a follow-up, complete the task/),
    ).toBeInTheDocument();
  });

  it.each(['LINKEDIN_FOLLOWED', 'LINKEDIN_COMMENTED'])(
    'should explicitly label a manually recorded %s activity',
    async (activity) => {
      const user = userEvent.setup();
      renderForm(false);
      await user.selectOptions(
        screen.getByLabelText('Log a completed activity'),
        activity,
      );
      await user.click(screen.getByRole('button', { name: 'Save activity' }));
      expect(mockCreateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'sequence.activity-recorded',
          properties: expect.objectContaining({ source: 'manual', activity }),
        }),
      );
    },
  );

  it('should retain notes and reuse the activity ID when saving fails', async () => {
    const user = userEvent.setup();
    mockCreateOneRecord.mockRejectedValue(new Error('Offline'));
    renderForm();
    await user.selectOptions(
      screen.getByLabelText('Call result'),
      'NO_RESPONSE',
    );
    await user.type(screen.getByLabelText('Notes (optional)'), 'Try later');
    await user.click(screen.getByRole('button', { name: 'Save call result' }));
    await waitFor(() => expect(mockError).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Try later');
    expect(mockSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save call result' }));
    expect(mockCreateOneRecord.mock.calls[0][0].id).toBe(
      mockCreateOneRecord.mock.calls[1][0].id,
    );
  });

  it('should not duplicate a result while a save is pending', async () => {
    const user = userEvent.setup();
    mockCreateOneRecord.mockReturnValue(new Promise(() => undefined));
    renderForm();
    await user.selectOptions(screen.getByLabelText('Call result'), 'VOICEMAIL');
    const save = screen.getByRole('button', { name: 'Save call result' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mockCreateOneRecord).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
  });

  it.each([true, false])(
    'should respect both task and timeline write permissions (%s)',
    async (timelinePermission) => {
      mockCanUpdate = timelinePermission;
      renderForm(true, !timelinePermission);
      expect(screen.getByLabelText('Call result')).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Save call result' }),
      ).toBeDisabled();
      expect(mockCreateOneRecord).not.toHaveBeenCalled();
    },
  );

  it('should clear the draft when switching to another prospect', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SequenceActivityForm
        key="first"
        personId="first"
        isCallTask={true}
        canRecord={true}
        onSaved={mockSaved}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText('Call result'),
      'INTERESTED',
    );
    await user.type(
      screen.getByLabelText('Notes (optional)'),
      'First prospect only',
    );
    rerender(
      <SequenceActivityForm
        key="second"
        personId="second"
        isCallTask={true}
        canRecord={true}
        onSaved={mockSaved}
      />,
    );
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Call result')).toHaveValue('');
  });
});
