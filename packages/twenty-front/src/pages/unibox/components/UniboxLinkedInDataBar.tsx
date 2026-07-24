import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { SearchInput } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type LinkedinUniboxDataset } from '@/unibox/types/LinkedinUniboxRecords';
import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import { UniboxLinkedInDatasetPicker } from '~/pages/unibox/components/UniboxLinkedInDatasetPicker';

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
  max-width: 360px;
  min-width: 200px;
  width: 32vw;
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  height: 30px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

export const UniboxLinkedInDataBar = ({
  dataset,
  search,
  dateRange,
  onDatasetChange,
  onSearchChange,
  onDateRangeChange,
}: {
  dataset: LinkedinUniboxDataset;
  search: string;
  dateRange: UniboxDateRange;
  onDatasetChange: (value: LinkedinUniboxDataset) => void;
  onSearchChange: (value: string) => void;
  onDateRangeChange: (value: UniboxDateRange) => void;
}) => (
  <StyledBar>
    <UniboxLinkedInDatasetPicker value={dataset} onChange={onDatasetChange} />
    <StyledSearch>
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder={t`Search LinkedIn data`}
      />
    </StyledSearch>
    <StyledSelect
      aria-label={t`LinkedIn data date range`}
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
