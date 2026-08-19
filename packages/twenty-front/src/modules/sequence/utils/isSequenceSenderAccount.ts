import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import {
  ConnectedAccountProvider,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';

const SEQUENCE_SENDER_PROVIDERS: ReadonlySet<ConnectedAccountProvider> =
  new Set([
    ConnectedAccountProvider.GOOGLE,
    ConnectedAccountProvider.MICROSOFT,
    ConnectedAccountProvider.IMAP_SMTP_CALDAV,
  ]);

export const isSequenceSenderAccount = (
  account: SequenceSenderAccount,
): boolean =>
  account.archivedAt === null &&
  SEQUENCE_SENDER_PROVIDERS.has(account.provider);

export const isSequenceEmailSenderAccountReady = (
  account: SequenceSenderAccount,
): boolean =>
  isSequenceSenderAccount(account) &&
  account.authFailedAt === null &&
  account.messageChannels.some(
    (messageChannel) =>
      messageChannel.handle === account.handle &&
      messageChannel.isSyncEnabled &&
      messageChannel.syncStatus === MessageChannelSyncStatus.ACTIVE,
  );
