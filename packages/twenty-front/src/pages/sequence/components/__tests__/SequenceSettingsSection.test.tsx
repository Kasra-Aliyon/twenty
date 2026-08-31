import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';

import { SequenceSettingsSection } from '~/pages/sequence/components/SequenceSettingsSection';
import { type SequenceRecord } from '~/pages/sequence/types/SequenceRecords';

const mockUpdateOneRecord = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock('@/settings/accounts/hooks/useMyConnectedAccounts', () => ({
  useMyConnectedAccounts: () => ({
    accounts: [
      { id: 'sender-id', handle: 'sender@example.com' },
      { id: 'linkedin-only-id', handle: 'linkedin@example.com' },
    ],
  }),
}));

jest.mock('@/sequence/utils/isSequenceSenderAccount', () => ({
  isSequenceSenderAccount: () => true,
  isSequenceEmailSenderAccountReady: ({ id }: { id: string }) =>
    id === 'sender-id',
}));

jest.mock('@/sequence/components/SequenceMailboxMultiSelect', () => ({
  SequenceMailboxMultiSelect: ({
    options,
  }: {
    options: Array<{ label: string; value: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
  }),
}));

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
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
  Toggle: ({ value }: { value: boolean }) => (
    <input type="checkbox" checked={value} readOnly />
  ),
  StyledTabContainer: ({ children }: { children: ReactNode }) => children,
}));

const sequence = {
  id: 'sequence-id',
  name: 'Recipient-local sequence',
  status: SEQUENCE_STATUSES.DRAFT,
  senderConnectedAccountId: 'sender-id',
  settings: {
    activeDays: [1, 2, 3, 4, 5],
    windowStart: '09:00',
    windowEnd: '17:00',
    timezone: 'Europe/Helsinki',
    dailyStartLimitEnabled: false,
    dailyStarts: 25,
    staggerMinutes: 5,
    linkedinDailyActionLimitEnabled: false,
    linkedinDailyActions: 20,
    linkedinDelayPatternMinutes: [1, 2, 3],
    stopOnReply: true,
  },
} as SequenceRecord;

describe('SequenceSettingsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOneRecord.mockResolvedValue({});
  });

  it('defaults legacy settings and persists recipient-local sending', async () => {
    render(
      <SequenceSettingsSection
        sequence={
          {
            ...sequence,
            settings: {
              ...sequence.settings,
              dailyStartLimitEnabled: true,
            },
          } as SequenceRecord
        }
        canUpdate
      />,
    );

    const timezoneMode = screen.getByLabelText('Apply email window in');

    expect(timezoneMode).toHaveValue(
      SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
    );

    fireEvent.change(timezoneMode, {
      target: { value: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT },
    });

    expect(screen.getByDisplayValue('Europe/Helsinki')).toBeEnabled();
    expect(
      screen.getByText(/missing or invalid values fall back to UTC/i),
    ).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('09:00')).toHaveLength(2);
    expect(
      screen.getByText(
        'Pending enrollments are admitted up to this cap per UTC day.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          objectNameSingular: 'sequence',
          idToUpdate: 'sequence-id',
          updateOneRecordInput: expect.objectContaining({
            settings: expect.objectContaining({
              sendWindowTimezoneMode:
                SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
              emailWindowStart: '09:00',
              emailWindowEnd: '17:00',
            }),
          }),
        }),
      );
    });
  });

  it('validates the sequence timezone in recipient email mode', async () => {
    render(
      <SequenceSettingsSection
        sequence={
          {
            ...sequence,
            settings: {
              ...sequence.settings,
              timezone: 'Not/A-Timezone',
              sendWindowTimezoneMode:
                SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
            },
          } as SequenceRecord
        }
        canUpdate
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(mockEnqueueErrorSnackBar).toHaveBeenCalledWith({
        message: 'Enter a valid IANA timezone such as Europe/Helsinki.',
      });
    });
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it('keeps accounts without inbox sync available for LinkedIn-only sequences', () => {
    render(<SequenceSettingsSection sequence={sequence} canUpdate />);

    expect(screen.getByText('sender@example.com')).toBeInTheDocument();
    expect(
      screen.getByText(
        'linkedin@example.com (LinkedIn only - email sending not ready)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /LinkedIn-only sequences do not require mailbox authentication or inbox sync; automated email steps require every selected account to be authenticated and have active inbox sync before activation/,
      ),
    ).toBeInTheDocument();
  });
});
