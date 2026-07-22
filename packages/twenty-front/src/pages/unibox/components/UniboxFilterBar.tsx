import { styled } from '@linaria/react';
import { SearchInput } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import { UniboxRecordListFilter } from '~/pages/unibox/components/UniboxRecordListControls';
import { t } from '@lingui/core/macro';

const StyledBar = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 40px;
  padding: 0 ${themeCssVariables.spacing[3]};
`;

const StyledSearch = styled.div`
  max-width: 300px;
  min-width: 180px;
  width: 30vw;
`;

const StyledUnreadLabel = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
  white-space: nowrap;
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  height: 30px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

export const UniboxFilterBar = ({
  search,
  recordListId,
  unreadOnly,
  dateRange,
  onSearchChange,
  onRecordListChange,
  onUnreadOnlyChange,
  onDateRangeChange,
}: {
  search: string;
  recordListId: string | null;
  unreadOnly: boolean;
  dateRange: UniboxDateRange;
  onSearchChange: (value: string) => void;
  onRecordListChange: (value: string | null) => void;
  onUnreadOnlyChange: (value: boolean) => void;
  onDateRangeChange: (value: UniboxDateRange) => void;
}) => (
  <StyledBar>
    <UniboxRecordListFilter
      value={recordListId}
      onChange={onRecordListChange}
    />
    <StyledSearch>
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder={t`Search messages`}
      />
    </StyledSearch>
    <StyledUnreadLabel>
      <input
        type="checkbox"
        checked={unreadOnly}
        onChange={(event) => onUnreadOnlyChange(event.target.checked)}
      />
      {t`Unread only`}
    </StyledUnreadLabel>
    <StyledSelect
      aria-label={t`Message date range`}
      value={dateRange}
      onChange={(event) =>
        onDateRangeChange(event.target.value as UniboxDateRange)
      }
    >
      <option value="ALL">{t`All time`}</option>
      <option value="LAST_7_DAYS">{t`Last 7 days`}</option>
      <option value="LAST_30_DAYS">{t`Last 30 days`}</option>
      <option value="LAST_90_DAYS">{t`Last 90 days`}</option>
    </StyledSelect>
  </StyledBar>
);
