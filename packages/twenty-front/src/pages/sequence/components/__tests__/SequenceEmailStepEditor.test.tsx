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
        onExecutionModeChange(SEQUENCE_ACTION_EXECUTION_MODES.MANUAL)
      }
    >
      Switch to manual
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
  LightIconButton: ({
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
  TabButton: ({ title, onClick }: { title: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  ),
  Toggle: ({ value }: { value: boolean }) => (
    <input type="checkbox" checked={value} readOnly />
  ),
  StyledTabContainer: ({ children }: { children: ReactNode }) => children,
  TabContent: ({ children }: { children: ReactNode }) => children,
}));

describe('SequenceEmailStepEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOneRecord.mockResolvedValue({});
  });

  it('saves two variants with a complementary traffic split', async () => {
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject A',
      bodyHtml: '<p>Body A</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
    };
    const step = {
      id: 'step-id',
      settings,
    } as SequenceStepRecord;

    render(
      <SequenceEmailStepEditor
        step={step}
        settings={settings}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add B variant' }));

    expect(
      screen.getByRole('button', { name: 'Variant B' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Subject A'), {
      target: { value: 'Subject B' },
    });
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save email step' }));

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith({
        objectNameSingular: 'sequenceStep',
        idToUpdate: 'step-id',
        updateOneRecordInput: {
          settings: expect.objectContaining({
            subject: 'Subject A',
            bodyHtml: '<p>Body A</p>',
            variants: [
              {
                id: 'control',
                name: 'A',
                subject: 'Subject A',
                bodyHtml: '<p>Body A</p>',
                weight: 70,
              },
              {
                id: expect.any(String),
                name: 'B',
                subject: 'Subject B',
                bodyHtml: '<p>Body A</p>',
                weight: 30,
              },
            ],
          }),
        },
      });
    });
  });

  it('returns to the control variant before saving in manual mode', async () => {
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject A',
      bodyHtml: '<p>Body A</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      manualTaskTitle: 'Send this email',
    };
    const step = {
      id: 'step-id',
      settings,
    } as SequenceStepRecord;

    render(
      <SequenceEmailStepEditor
        step={step}
        settings={settings}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add B variant' }));
    fireEvent.change(screen.getByDisplayValue('Subject A'), {
      target: { value: 'Subject B' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to manual' }));

    expect(screen.getByDisplayValue('Subject A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save email step' }));

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith({
        objectNameSingular: 'sequenceStep',
        idToUpdate: 'step-id',
        updateOneRecordInput: {
          settings: expect.objectContaining({
            subject: 'Subject A',
            bodyHtml: '<p>Body A</p>',
            executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
            variants: undefined,
          }),
        },
      });
    });
  });

  it('offers a spintax authoring shortcut for the subject', () => {
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject ',
      bodyHtml: '<p>Body</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
    };

    render(
      <SequenceEmailStepEditor
        step={{ id: 'step-id', settings } as SequenceStepRecord}
        settings={settings}
        disabled={false}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Insert subject spintax' }),
    );

    expect(screen.getByDisplayValue('Subject {Hi|Hello}')).toBeInTheDocument();
    expect(screen.getByText('{Hi|Hello}')).toBeInTheDocument();
  });

  it('offers a spintax authoring shortcut for the body', () => {
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
    };

    render(
      <SequenceEmailStepEditor
        step={{ id: 'step-id', settings } as SequenceStepRecord}
        settings={settings}
        disabled={false}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Insert body spintax' }),
    );

    expect(
      screen.getByDisplayValue('<p>Body</p><p>{Hi|Hello}</p>'),
    ).toBeInTheDocument();
  });

  it('shows an error and prevents saving invalid spintax', () => {
    const settings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
    };

    render(
      <SequenceEmailStepEditor
        step={{ id: 'step-id', settings } as SequenceStepRecord}
        settings={settings}
        disabled={false}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Subject'), {
      target: { value: 'Subject {Hi|Hello' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Variant A subject:');
    expect(
      screen.getByRole('button', { name: 'Save email step' }),
    ).toBeDisabled();
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });
});
