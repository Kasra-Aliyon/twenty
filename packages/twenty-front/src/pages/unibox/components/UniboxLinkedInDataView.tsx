import { type LinkedinUniboxDataset } from '@/unibox/types/LinkedinUniboxRecords';
import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import { UniboxLinkedInConnectionsTable } from '~/pages/unibox/components/UniboxLinkedInConnectionsTable';
import { UniboxLinkedInInvitationsTable } from '~/pages/unibox/components/UniboxLinkedInInvitationsTable';
import { UniboxLinkedInMessagesTable } from '~/pages/unibox/components/UniboxLinkedInMessagesTable';

export const UniboxLinkedInDataView = ({
  dataset,
  search,
  dateRange,
}: {
  dataset: Exclude<LinkedinUniboxDataset, 'MESSAGE_THREADS'>;
  search: string;
  dateRange: UniboxDateRange;
}) => {
  if (dataset === 'CONNECTIONS') {
    return (
      <UniboxLinkedInConnectionsTable search={search} dateRange={dateRange} />
    );
  }

  if (dataset === 'INVITATIONS') {
    return (
      <UniboxLinkedInInvitationsTable search={search} dateRange={dateRange} />
    );
  }

  return <UniboxLinkedInMessagesTable search={search} dateRange={dateRange} />;
};
