import { t } from '@lingui/core/macro';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type LinkedinUniboxMessage } from '@/unibox/types/LinkedinUniboxRecords';
import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import {
  buildLinkedinDataFilter,
  formatLinkedinDataDate,
  StyledLinkedinDataPrimaryText,
  StyledLinkedinDataSecondaryText,
  StyledLinkedinDataStatus,
  UniboxLinkedInDataTable,
} from '~/pages/unibox/components/UniboxLinkedInDataTable';

const DATA_PAGE_SIZE = 50;

export const UniboxLinkedInMessagesTable = ({
  search,
  dateRange,
}: {
  search: string;
  dateRange: UniboxDateRange;
}) => {
  const result = useFindManyRecords<LinkedinUniboxMessage>({
    objectNameSingular: 'linkedinMessage',
    filter: buildLinkedinDataFilter({
      dateField: 'deliveredAt',
      dateRange,
      search,
      searchFields: ['senderName', 'body'],
    }),
    orderBy: [{ deliveredAt: 'DescNullsLast' }],
    recordGqlFields: {
      id: true,
      body: true,
      deliveredAt: true,
      direction: true,
      senderName: true,
      senderLinkedinUrn: true,
      threadId: true,
    },
    limit: DATA_PAGE_SIZE,
  });

  return (
    <UniboxLinkedInDataTable
      records={result.records}
      totalCount={result.totalCount}
      loading={result.loading}
      hasNextPage={result.hasNextPage}
      columns={[
        {
          key: 'sender',
          label: t`Sender`,
          render: (record) => (
            <>
              <StyledLinkedinDataPrimaryText>
                {record.senderName || t`LinkedIn member`}
              </StyledLinkedinDataPrimaryText>
              <StyledLinkedinDataSecondaryText>
                {record.threadId}
              </StyledLinkedinDataSecondaryText>
            </>
          ),
        },
        {
          key: 'direction',
          label: t`Direction`,
          render: (record) => (
            <StyledLinkedinDataStatus
              tone={record.direction === 'INBOUND' ? 'green' : 'blue'}
            >
              {record.direction === 'INBOUND' ? t`Inbound` : t`Outbound`}
            </StyledLinkedinDataStatus>
          ),
        },
        {
          key: 'body',
          label: t`Message`,
          render: (record) => record.body || '—',
        },
        {
          key: 'deliveredAt',
          label: t`Delivered`,
          render: (record) => formatLinkedinDataDate(record.deliveredAt),
        },
      ]}
      onLoadMore={() => void result.fetchMoreRecords()}
    />
  );
};
