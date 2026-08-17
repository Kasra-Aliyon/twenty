import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { IconInbox, IconUserPlus, IconUsers } from 'twenty-ui/icon';
import { SearchInput, TabButton, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type UniboxDateRange } from '@/unibox/types/UniboxThread';
import { UniboxRecordListFilter } from '~/pages/unibox/components/UniboxRecordListControls';

export type LinkedinTab = 'CONNECTIONS' | 'INBOX' | 'SENT_REQUESTS';

const StyledBar = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  min-height: 40px;
  overflow-x: auto;
  padding: 0 ${themeCssVariables.spacing[3]};
`;

const StyledTabs = styled.div`
  align-self: stretch;
  display: flex;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledSearch = styled.div`
  max-width: 320px;
  min-width: 200px;
  width: 28vw;
`;

const StyledToggleLabel = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  white-space: nowrap;
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

export const LinkedinFilterBar = ({
  tab,
  search,
  recordListId,
  onlyCrmContacts,
  unreadOnly,
  dateRange,
  onTabChange,
  onSearchChange,
  onRecordListChange,
  onOnlyCrmContactsChange,
  onUnreadOnlyChange,
  onDateRangeChange,
}: {
  tab: LinkedinTab;
  search: string;
  recordListId: string | null;
  onlyCrmContacts: boolean;
  unreadOnly: boolean;
  dateRange: UniboxDateRange;
  onTabChange: (tab: LinkedinTab) => void;
  onSearchChange: (value: string) => void;
  onRecordListChange: (value: string | null) => void;
  onOnlyCrmContactsChange: (value: boolean) => void;
  onUnreadOnlyChange: (value: boolean) => void;
  onDateRangeChange: (value: UniboxDateRange) => void;
}) => (
  <StyledBar>
    <StyledTabs>
      <TabButton
        id="linkedin-inbox"
        title={t`Inbox`}
        LeftIcon={IconInbox}
        active={tab === 'INBOX'}
        onClick={() => onTabChange('INBOX')}
      />
      <TabButton
        id="linkedin-sent-requests"
        title={t`Sent requests`}
        LeftIcon={IconUserPlus}
        active={tab === 'SENT_REQUESTS'}
        onClick={() => onTabChange('SENT_REQUESTS')}
      />
      <TabButton
        id="linkedin-connections"
        title={t`Connections`}
        LeftIcon={IconUsers}
        active={tab === 'CONNECTIONS'}
        onClick={() => onTabChange('CONNECTIONS')}
      />
    </StyledTabs>
    {tab === 'INBOX' && (
      <UniboxRecordListFilter
        value={recordListId}
        onChange={onRecordListChange}
      />
    )}
    <StyledSearch>
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder={
          tab === 'INBOX'
            ? t`Search LinkedIn conversations`
            : t`Search LinkedIn people`
        }
      />
    </StyledSearch>
    {tab === 'INBOX' && (
      <>
        <StyledToggleLabel>
          {t`Only Twenty contacts`}
          <Toggle
            value={onlyCrmContacts}
            onChange={onOnlyCrmContactsChange}
            toggleSize="small"
            aria-label={t`Only Twenty contacts`}
          />
        </StyledToggleLabel>
        <StyledUnreadLabel>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => onUnreadOnlyChange(event.target.checked)}
          />
          {t`Unread only`}
        </StyledUnreadLabel>
      </>
    )}
    <StyledSelect
      aria-label={t`LinkedIn date range`}
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
