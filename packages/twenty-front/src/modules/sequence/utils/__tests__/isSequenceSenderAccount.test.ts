import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import { isSequenceSenderAccount } from '@/sequence/utils/isSequenceSenderAccount';
import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';

const buildAccount = (
  overrides: Partial<SequenceSenderAccount> = {},
): SequenceSenderAccount => ({
  id: 'connected-account-id',
  handle: 'sender@example.com',
  provider: ConnectedAccountProvider.GOOGLE,
  archivedAt: null,
  authFailedAt: null,
  messageChannels: [
    {
      handle: 'sender@example.com',
      isSyncEnabled: true,
      syncStatus: MessageChannelSyncStatus.ACTIVE,
    },
  ],
  ...overrides,
});

describe('isSequenceSenderAccount', () => {
  it('accepts a supported mailbox with active inbox sync', () => {
    expect(isSequenceSenderAccount(buildAccount())).toBe(true);
  });

  it.each([
    {
      label: 'disabled',
      messageChannels: [
        {
          handle: 'sender@example.com',
          isSyncEnabled: false,
          syncStatus: MessageChannelSyncStatus.ACTIVE,
        },
      ],
    },
    {
      label: 'not active',
      messageChannels: [
        {
          handle: 'sender@example.com',
          isSyncEnabled: true,
          syncStatus: MessageChannelSyncStatus.FAILED_INSUFFICIENT_PERMISSIONS,
        },
      ],
    },
    {
      label: 'for a different address',
      messageChannels: [
        {
          handle: 'other@example.com',
          isSyncEnabled: true,
          syncStatus: MessageChannelSyncStatus.ACTIVE,
        },
      ],
    },
  ])('rejects inbox sync that is $label', ({ messageChannels }) => {
    expect(isSequenceSenderAccount(buildAccount({ messageChannels }))).toBe(
      false,
    );
  });

  it('rejects a mailbox with failed authentication', () => {
    expect(
      isSequenceSenderAccount(
        buildAccount({ authFailedAt: '2026-07-24T12:00:00.000Z' }),
      ),
    ).toBe(false);
  });
});
