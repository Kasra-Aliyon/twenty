import { t } from '@lingui/core/macro';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type LinkedinUniboxInvitation } from '@/unibox/types/LinkedinUniboxRecords';
import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import {
  buildLinkedinDataFilter,
  formatLinkedinDataDate,
  StyledLinkedinDataPrimaryText,
  StyledLinkedinDataProfileLink,
  StyledLinkedinDataSecondaryText,
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
  const dataFilter = buildLinkedinDataFilter({
    dateField: 'sentAt',
    dateRange,
    search,
    searchFields: ['name', 'handle', 'headline', 'message'],
  });
  const result = useFindManyRecords<LinkedinUniboxInvitation>({
    objectNameSingular: 'linkedinInvitation',
    filter: dataFilter
      ? { and: [{ direction: { eq: 'SENT' } }, dataFilter] }
      : { direction: { eq: 'SENT' } },
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
          key: 'profile',
          label: t`LinkedIn profile`,
          render: (record) => (
            <StyledLinkedinDataProfileLink
              href={`https://www.linkedin.com/in/${record.handle}`}
              target="_blank"
              rel="noreferrer"
            >
              {record.handle || t`Open profile`}
            </StyledLinkedinDataProfileLink>
          ),
        },
        {
          key: 'message',
          label: t`Message`,
          render: (record) => record.message || '—',
        },
        {
          key: 'sentAt',
          label: t`Request sent`,
          render: (record) => formatLinkedinDataDate(record.sentAt),
        },
      ]}
      onLoadMore={() => void result.fetchMoreRecords()}
    />
  );
};
