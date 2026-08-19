import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import {
  isSequenceEmailSenderAccountReady,
  isSequenceSenderAccount,
} from '@/sequence/utils/isSequenceSenderAccount';
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
  it('accepts an active supported account without inbox sync', () => {
    expect(isSequenceSenderAccount(buildAccount({ messageChannels: [] }))).toBe(
      true,
    );
  });

  it('rejects an archived account', () => {
    expect(
      isSequenceSenderAccount(
        buildAccount({ archivedAt: '2026-07-24T12:00:00.000Z' }),
      ),
    ).toBe(false);
  });

  it('accepts failed mailbox authentication for LinkedIn-only use', () => {
    expect(
      isSequenceSenderAccount(
        buildAccount({ authFailedAt: '2026-07-24T12:00:00.000Z' }),
      ),
    ).toBe(true);
  });

  it('rejects a provider that cannot identify a sequence sender', () => {
    expect(
      isSequenceSenderAccount(
        buildAccount({ provider: ConnectedAccountProvider.OIDC }),
      ),
    ).toBe(false);
  });
});

describe('isSequenceEmailSenderAccountReady', () => {
  it('accepts a supported account with active inbox sync', () => {
    expect(isSequenceSenderAccount(buildAccount())).toBe(true);
    expect(isSequenceEmailSenderAccountReady(buildAccount())).toBe(true);
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
    expect(
      isSequenceEmailSenderAccountReady(buildAccount({ messageChannels })),
    ).toBe(false);
  });

  it('rejects an otherwise ready mailbox when authentication has failed', () => {
    expect(
      isSequenceEmailSenderAccountReady(
        buildAccount({ authFailedAt: '2026-07-24T12:00:00.000Z' }),
      ),
    ).toBe(false);
  });
});
