import { t } from '@lingui/core/macro';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type LinkedinUniboxInvitation } from '@/unibox/types/LinkedinUniboxRecords';
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

export const UniboxLinkedInInvitationsTable = ({
  search,
  dateRange,
}: {
  search: string;
  dateRange: UniboxDateRange;
}) => {
  const result = useFindManyRecords<LinkedinUniboxInvitation>({
    objectNameSingular: 'linkedinInvitation',
    filter: buildLinkedinDataFilter({
      dateField: 'sentAt',
      dateRange,
      search,
      searchFields: ['name', 'handle', 'headline', 'message'],
    }),
    orderBy: [{ sentAt: 'DescNullsLast' }],
    recordGqlFields: {
      id: true,
      name: true,
      direction: true,
      handle: true,
      headline: true,
      message: true,
      sentAt: true,
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
          key: 'person',
          label: t`Invitation`,
          render: (record) => (
            <>
              <StyledLinkedinDataPrimaryText>
                {record.name}
              </StyledLinkedinDataPrimaryText>
              <StyledLinkedinDataSecondaryText>
                {record.headline || record.handle}
              </StyledLinkedinDataSecondaryText>
            </>
          ),
        },
        {
          key: 'direction',
          label: t`Direction`,
          render: (record) => (
            <StyledLinkedinDataStatus
              tone={record.direction === 'RECEIVED' ? 'green' : 'blue'}
            >
              {record.direction === 'RECEIVED' ? t`Received` : t`Sent`}
            </StyledLinkedinDataStatus>
          ),
        },
        {
          key: 'message',
          label: t`Message`,
          render: (record) => record.message || '—',
        },
        {
          key: 'sentAt',
          label: t`Sent`,
          render: (record) => formatLinkedinDataDate(record.sentAt),
        },
      ]}
      onLoadMore={() => void result.fetchMoreRecords()}
    />
  );
};
