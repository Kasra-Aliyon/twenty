import { t } from '@lingui/core/macro';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type LinkedinUniboxConnection } from '@/unibox/types/LinkedinUniboxRecords';
import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import {
  buildLinkedinDataFilter,
  formatLinkedinDataDate,
  StyledLinkedinDataPrimaryText,
  StyledLinkedinDataProfileLink,
  StyledLinkedinDataSecondaryText,
  StyledLinkedinDataStatus,
  UniboxLinkedInDataTable,
} from '~/pages/unibox/components/UniboxLinkedInDataTable';

const DATA_PAGE_SIZE = 50;

export const UniboxLinkedInConnectionsTable = ({
  search,
  dateRange,
}: {
  search: string;
  dateRange: UniboxDateRange;
}) => {
  const result = useFindManyRecords<LinkedinUniboxConnection>({
    objectNameSingular: 'linkedinConnection',
    filter: buildLinkedinDataFilter({
      dateField: 'connectedAt',
      dateRange,
      search,
      searchFields: ['name', 'handle', 'headline'],
    }),
    orderBy: [{ connectedAt: 'DescNullsLast' }],
    recordGqlFields: {
      id: true,
      name: true,
      handle: true,
      headline: true,
      connectedAt: true,
      profileUrl: true,
      personId: true,
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
          label: t`Connection`,
          render: (record) => (
            <>
              <StyledLinkedinDataPrimaryText>
                {record.name}
              </StyledLinkedinDataPrimaryText>
              <StyledLinkedinDataSecondaryText>
                {record.headline || '—'}
              </StyledLinkedinDataSecondaryText>
            </>
          ),
        },
        {
          key: 'profile',
          label: t`LinkedIn profile`,
          render: (record) => (
            <StyledLinkedinDataProfileLink
              href={
                record.profileUrl?.primaryLinkUrl ||
                `https://www.linkedin.com/in/${record.handle}`
              }
              target="_blank"
              rel="noreferrer"
            >
              {record.handle || t`Open profile`}
            </StyledLinkedinDataProfileLink>
          ),
        },
        {
          key: 'crm',
          label: t`Twenty contact`,
          render: (record) => (
            <StyledLinkedinDataStatus tone={record.personId ? 'green' : 'gray'}>
              {record.personId ? t`Matched` : t`Not matched`}
            </StyledLinkedinDataStatus>
          ),
        },
        {
          key: 'connectedAt',
          label: t`Connected`,
          render: (record) => formatLinkedinDataDate(record.connectedAt),
        },
      ]}
      onLoadMore={() => void result.fetchMoreRecords()}
    />
  );
};
