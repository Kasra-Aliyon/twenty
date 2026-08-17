import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';

import { SequenceSettingsSection } from '~/pages/sequence/components/SequenceSettingsSection';
import { type SequenceRecord } from '~/pages/sequence/types/SequenceRecords';

const mockUpdateOneRecord = jest.fn();

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock('@/settings/accounts/hooks/useMyConnectedAccounts', () => ({
  useMyConnectedAccounts: () => ({
    accounts: [{ id: 'sender-id', handle: 'sender@example.com' }],
  }),
}));

jest.mock('@/sequence/utils/isSequenceSenderAccount', () => ({
  isSequenceSenderAccount: () => true,
}));

jest.mock('@/sequence/components/SequenceMailboxMultiSelect', () => ({
  SequenceMailboxMultiSelect: () => <div>Sender mailbox selector</div>,
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: jest.fn(),
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
    render(<SequenceSettingsSection sequence={sequence} canUpdate />);

    const timezoneMode = screen.getByLabelText('Apply sending hours in');

    expect(timezoneMode).toHaveValue(
      SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
    );

    fireEvent.change(timezoneMode, {
      target: { value: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT },
    });

    expect(screen.getByDisplayValue('Europe/Helsinki')).toBeDisabled();
    expect(
      screen.getByText(/Missing or invalid values fall back to UTC/),
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
            }),
          }),
        }),
      );
    });
  });
});
