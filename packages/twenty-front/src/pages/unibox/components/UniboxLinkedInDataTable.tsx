import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { format } from 'date-fns';
import { type ReactNode } from 'react';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type UniboxDateRange } from '@/unibox/types/UniboxThread';

const DATE_RANGE_DAYS: Record<Exclude<UniboxDateRange, 'ALL'>, number> = {
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
};

const StyledRoot = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
`;

const StyledSummary = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledTableContainer = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const StyledTable = styled.table`
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
`;

const StyledHeaderCell = styled.th`
  background: ${themeCssVariables.background.secondary};
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  position: sticky;
  text-align: left;
  top: 0;
  z-index: 1;
`;

const StyledCell = styled.td`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  padding: ${themeCssVariables.spacing[3]};
  text-overflow: ellipsis;
  vertical-align: top;
`;

export const StyledLinkedinDataPrimaryText = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const StyledLinkedinDataSecondaryText = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-top: ${themeCssVariables.spacing[1]};
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const StyledLinkedinDataProfileLink = styled.a`
  color: ${themeCssVariables.color.blue};
  text-decoration: none;
`;

export const StyledLinkedinDataStatus = styled.span<{
  tone: 'blue' | 'green' | 'gray';
}>`
  background: ${({ tone }) =>
    tone === 'green'
      ? themeCssVariables.background.transparent.success
      : tone === 'blue'
        ? themeCssVariables.background.transparent.blue
        : themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  display: inline-flex;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  padding: ${themeCssVariables.spacing[8]};
`;

const StyledLoadMore = styled.div`
  display: flex;
  justify-content: center;
  padding: ${themeCssVariables.spacing[3]};
`;

export type LinkedinDataTableColumn<TRecord> = {
  key: string;
  label: string;
  render: (record: TRecord) => ReactNode;
};

export const buildLinkedinDataFilter = ({
  dateField,
  dateRange,
  search,
  searchFields,
}: {
  dateField: string;
  dateRange: UniboxDateRange;
  search: string;
  searchFields: string[];
}) => {
  const filters: Record<string, unknown>[] = [];
  const normalizedSearch = search.trim();

  if (normalizedSearch) {
    filters.push({
      or: searchFields.map((field) => ({
        [field]: { ilike: `%${normalizedSearch}%` },
      })),
    });
  }

  if (dateRange !== 'ALL') {
    const date = new Date();

    date.setDate(date.getDate() - DATE_RANGE_DAYS[dateRange]);
    filters.push({ [dateField]: { gte: date.toISOString() } });
  }

  return filters.length === 0
    ? undefined
    : filters.length === 1
      ? filters[0]
      : { and: filters };
};

export const formatLinkedinDataDate = (value: string | null) =>
  value ? format(new Date(value), 'd MMM yyyy, HH:mm') : '—';

export const UniboxLinkedInDataTable = <TRecord extends { id: string }>({
  columns,
  records,
  totalCount,
  loading,
  hasNextPage,
  onLoadMore,
}: {
  columns: LinkedinDataTableColumn<TRecord>[];
  records: TRecord[];
  totalCount: number | undefined;
  loading: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
}) => (
  <StyledRoot>
    <StyledSummary>
      {t`${totalCount ?? records.length} synchronized records`}
    </StyledSummary>
    {loading && records.length === 0 ? (
      <StyledEmpty>{t`Loading LinkedIn data…`}</StyledEmpty>
    ) : records.length === 0 ? (
      <StyledEmpty>{t`No synchronized LinkedIn records found.`}</StyledEmpty>
    ) : (
      <StyledTableContainer>
        <StyledTable>
          <thead>
            <tr>
              {columns.map((column) => (
                <StyledHeaderCell key={column.key}>
                  {column.label}
                </StyledHeaderCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                {columns.map((column) => (
                  <StyledCell key={column.key}>
                    {column.render(record)}
                  </StyledCell>
                ))}
              </tr>
            ))}
          </tbody>
        </StyledTable>
        {hasNextPage && (
          <StyledLoadMore>
            <Button
              title={t`Load more`}
              variant="secondary"
              size="small"
              onClick={onLoadMore}
            />
          </StyledLoadMore>
        )}
      </StyledTableContainer>
    )}
  </StyledRoot>
);
