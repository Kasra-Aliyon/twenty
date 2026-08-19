import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';

import { SequenceCreatePage } from '~/pages/sequence/SequenceCreatePage';

const mockCreateOneRecord = jest.fn();

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

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/settings/accounts/hooks/useMyConnectedAccounts', () => ({
  useMyConnectedAccounts: () => ({
    accounts: [
      {
        id: 'ready-account-id',
        handle: 'ready@example.com',
        provider: ConnectedAccountProvider.GOOGLE,
        archivedAt: null,
        authFailedAt: null,
        messageChannels: [
          {
            handle: 'ready@example.com',
            isSyncEnabled: true,
            syncStatus: MessageChannelSyncStatus.ACTIVE,
          },
        ],
      },
      {
        id: 'linkedin-only-account-id',
        handle: 'linkedin@example.com',
        provider: ConnectedAccountProvider.GOOGLE,
        archivedAt: null,
        authFailedAt: '2026-08-17T08:00:00.000Z',
        messageChannels: [],
      },
    ],
  }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
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

jest.mock('@/ui/layout/page/components/PageCardHeader', () => ({
  PageCardHeader: ({ title }: { title: ReactNode }) => <div>{title}</div>,
}));

jest.mock('@/ui/layout/page/components/PageCardLayout', () => ({
  PageCardLayout: ({
    header,
    children,
  }: {
    header: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {header}
      {children}
    </>
  ),
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
  }: {
    title: string;
    type?: 'button' | 'submit';
    disabled?: boolean;
  }) => (
    <button type={type} disabled={disabled}>
      {title}
    </button>
  ),
}));

describe('SequenceCreatePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOneRecord.mockResolvedValue({ id: 'new-sequence-id' });
  });

  it('allows an account without email readiness to create a LinkedIn-only draft', async () => {
    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <SequenceCreatePage />
      </MemoryRouter>,
    );

    const senderAccountSelect = screen.getByRole('combobox', {
      name: 'Sender account',
    });

    expect(senderAccountSelect).toHaveDisplayValue('ready@example.com');
    expect(
      screen.getByRole('option', {
        name: 'linkedin@example.com (LinkedIn only - email sending not ready)',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Automated email steps require every selected sender account to be authenticated and have active inbox sync before activation/,
      ),
    ).toBeInTheDocument();

    fireEvent.change(senderAccountSelect, {
      target: { value: 'linkedin-only-account-id' },
    });
    fireEvent.change(screen.getByPlaceholderText('Outbound follow-up'), {
      target: { value: 'LinkedIn outreach' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create sequence' }));

    await waitFor(() => {
      expect(mockCreateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'LinkedIn outreach',
          senderConnectedAccountId: 'linkedin-only-account-id',
          settings: expect.objectContaining({
            senderConnectedAccountIds: ['linkedin-only-account-id'],
          }),
        }),
      );
    });
  });
});
