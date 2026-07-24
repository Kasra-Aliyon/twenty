import {
  type ConnectedAccountProvider,
  type MessageChannelSyncStatus,
} from 'twenty-shared/types';

export type SequenceSenderAccount = {
  id: string;
  handle: string;
  provider: ConnectedAccountProvider;
  archivedAt: string | null;
  authFailedAt: string | null;
  messageChannels: Array<{
    handle: string;
    isSyncEnabled: boolean;
    syncStatus: MessageChannelSyncStatus;
  }>;
};
