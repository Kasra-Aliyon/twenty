import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SEQUENCE_STATUSES } from 'twenty-shared/types';

import { SequenceCreatePage } from '~/pages/sequence/SequenceCreatePage';
import { SequenceSettingsSection } from '~/pages/sequence/components/SequenceSettingsSection';
import { type SequenceRecord } from '~/pages/sequence/types/SequenceRecords';

const mockCreateOneRecord = jest.fn();
const mockUpdateOneRecord = jest.fn();
let mockAccountsLoading = false;

jest.mock('@/object-metadata/hooks/useDoObjectMetadataItemsExist', () => ({
  useDoObjectMetadataItemsExist: () => true,
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({ objectMetadataItem: { id: 'sequence' } }),
}));

jest.mock('@/object-record/hooks/useCreateOneRecord', () => ({
  useCreateOneRecord: () => ({
    createOneRecord: mockCreateOneRecord,
    loading: false,
  }),
}));

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/settings/accounts/hooks/useMyConnectedAccounts', () => ({
  useMyConnectedAccounts: () => ({
    accounts: [],
    loading: mockAccountsLoading,
  }),
}));

jest.mock('@/sequence/components/SequenceMailboxMultiSelect', () => ({
  SequenceMailboxMultiSelect: () => null,
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
    options: Array<{ label: string; value: string }>;
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

jest.mock('@/ui/layout/page/components/PageCardHeader', () => ({
  PageCardHeader: ({ title }: { title: ReactNode }) => <div>{title}</div>,
}));

jest.mock('@/ui/layout/page/components/PageCardLayout', () => ({
  PageCardLayout: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/ui/layout/page/components/PageContainer', () => ({
  PageContainer: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    type,
    disabled,
    onClick,
  }: {
    title: string;
    type?: 'button' | 'submit';
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type={type ?? 'button'} disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
  Toggle: ({ value }: { value: boolean }) => (
    <input type="checkbox" checked={value} readOnly />
  ),
}));

describe('senderless sequence drafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccountsLoading = false;
    mockCreateOneRecord.mockResolvedValue({ id: 'new-sequence-id' });
    mockUpdateOneRecord.mockResolvedValue({});
  });

  it('creates a draft with a null primary sender and an empty sender pool', async () => {
    render(
      <MemoryRouter>
        <SequenceCreatePage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/You can create this draft without a sender/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Outbound follow-up'), {
      target: { value: 'Senderless draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create sequence' }));

    await waitFor(() => {
      expect(mockCreateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Senderless draft',
          senderConnectedAccountId: null,
          settings: expect.objectContaining({
            senderConnectedAccountIds: [],
          }),
        }),
      );
    });
  });

  it('waits for account discovery before offering a senderless draft', () => {
    mockAccountsLoading = true;

    render(
      <MemoryRouter>
        <SequenceCreatePage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('Checking connected sender accounts…'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create sequence' }),
    ).toBeDisabled();
    expect(mockCreateOneRecord).not.toHaveBeenCalled();
  });

  it('saves settings without imposing a sender requirement', async () => {
    const sequence = {
      id: 'sequence-id',
      name: 'Senderless draft',
      status: SEQUENCE_STATUSES.DRAFT,
      senderConnectedAccountId: null,
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

    render(<SequenceSettingsSection sequence={sequence} canUpdate />);

    expect(
      screen.getByText(/You can save these settings without a sender/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOneRecordInput: expect.objectContaining({
            senderConnectedAccountId: null,
            settings: expect.objectContaining({
              senderConnectedAccountIds: [],
            }),
          }),
        }),
      );
    });
  });
});
