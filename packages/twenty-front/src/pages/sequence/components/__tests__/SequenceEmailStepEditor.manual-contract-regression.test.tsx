import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_STEP_TYPES,
  type SequenceEmailStepSettings,
} from 'twenty-shared/types';

import { SequenceEmailStepEditor } from '~/pages/sequence/components/SequenceEmailStepEditor';
import { type SequenceStepRecord } from '~/pages/sequence/types/SequenceRecords';

const mockUpdateOneRecord = jest.fn();

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: jest.fn(),
  }),
}));

jest.mock(
  '@/object-record/record-field/ui/form-types/components/FormAdvancedTextFieldInput',
  () => ({
    FormAdvancedTextFieldInput: ({
      defaultValue,
      onChange,
      placeholder,
    }: {
      defaultValue: string;
      onChange: (value: string) => void;
      placeholder: string;
    }) => (
      <textarea
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  }),
);

jest.mock('../SequenceExecutionModeFields', () => ({
  SequenceExecutionModeFields: ({
    onExecutionModeChange,
  }: {
    onExecutionModeChange: (
      mode: (typeof SEQUENCE_ACTION_EXECUTION_MODES)[keyof typeof SEQUENCE_ACTION_EXECUTION_MODES],
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onExecutionModeChange(SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED)
      }
    >
      Switch to automated
    </button>
  ),
}));

jest.mock('../SequenceVariablePicker', () => ({
  SequenceVariablePicker: () => null,
}));

jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    onClick,
    disabled,
  }: {
    title: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {title}
    </button>
  ),
  LightIconButton: () => null,
  TabButton: () => null,
  Toggle: () => null,
  StyledTabContainer: ({ children }: { children: ReactNode }) => children,
  TabContent: ({ children }: { children: ReactNode }) => children,
}));

describe('manual email step contract', () => {
  it('hides unsupported controls and clears their persisted values', async () => {
    mockUpdateOneRecord.mockResolvedValue({});
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
      threadAsReplyToPreviousEmail: true,
      stopOnReply: true,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
      manualTaskTitle: 'Send the email',
      manualTaskDescription: 'Use the approved draft.',
    };
    const step = { id: 'step-id', settings } as SequenceStepRecord;

    render(
      <SequenceEmailStepEditor
        step={step}
        settings={settings}
        disabled={false}
      />,
    );

    expect(
      screen.queryByText('Thread as a reply to the previous sequence email'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Stop on reply')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Manual email tasks do not record a sent-message thread/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save email step' }));

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOneRecordInput: {
            settings: expect.objectContaining({
              executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
              threadAsReplyToPreviousEmail: false,
              stopOnReply: false,
            }),
          },
        }),
      );
    });
  });

  it('restores sequence-level stop-on-reply inheritance when switching back to automated', async () => {
    mockUpdateOneRecord.mockResolvedValue({});
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: false,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
      manualTaskTitle: 'Send the email',
      manualTaskDescription: '',
    };
    const step = { id: 'step-id', settings } as SequenceStepRecord;

    render(
      <SequenceEmailStepEditor
        step={step}
        settings={settings}
        disabled={false}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to automated' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save email step' }));

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOneRecordInput: {
            settings: expect.objectContaining({
              executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
              stopOnReply: null,
            }),
          },
        }),
      );
    });
  });
});
