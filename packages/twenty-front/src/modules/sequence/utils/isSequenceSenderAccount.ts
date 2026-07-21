import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import { ConnectedAccountProvider } from 'twenty-shared/types';

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
  account.authFailedAt === null &&
  SEQUENCE_SENDER_PROVIDERS.has(account.provider);
