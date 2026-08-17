import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SettingsOutreachMailboxLimits } from '@/settings/outreach/components/SettingsOutreachMailboxLimits';

const mockUpdateSettings = jest.fn();

jest.mock('@/settings/accounts/hooks/useMyConnectedAccounts', () => {
  const accounts = [
    {
      id: 'account-id',
      handle: 'sender@example.com',
      sequenceDailyEmailLimitEnabled: false,
      sequenceDailyEmailLimit: 30,
    },
  ];

  return {
    useMyConnectedAccounts: () => ({ loading: false, accounts }),
  };
});

jest.mock('@/sequence/utils/isSequenceSenderAccount', () => ({
  isSequenceSenderAccount: () => true,
}));

jest.mock('@apollo/client/react', () => ({
  useMutation: () => [mockUpdateSettings],
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: jest.fn(),
  }),
}));

jest.mock('@/settings/components/SettingsCounter', () => ({
  SettingsCounter: ({
    value,
    onChange,
    disabled,
  }: {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
  }) => (
    <input
      type="number"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
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
  Toggle: ({
    value,
    onChange,
  }: {
    value: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="mailbox-limit-toggle"
      onClick={() => onChange(!value)}
    >
      {String(value)}
    </button>
  ),
}));

describe('SettingsOutreachMailboxLimits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateSettings.mockResolvedValue({});
  });

  it('saves the enabled state and validated mailbox limit', async () => {
    render(<SettingsOutreachMailboxLimits />);

    fireEvent.click(await screen.findByTestId('mailbox-limit-toggle'));
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '45' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save mailbox limits' }),
    );

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        variables: {
          id: 'account-id',
          input: {
            sequenceDailyEmailLimitEnabled: true,
            sequenceDailyEmailLimit: 45,
          },
        },
      });
    });
  });
});
