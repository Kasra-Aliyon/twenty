import { type ConnectedAccountProvider } from 'twenty-shared/types';

export type SequenceSenderAccount = {
  id: string;
  handle: string;
  provider: ConnectedAccountProvider;
  archivedAt: string | null;
  authFailedAt: string | null;
};
