import { styled } from '@linaria/react';
import { Link } from 'react-router-dom';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Avatar, AvatarGroup } from 'twenty-ui/data-display';
import { IconPlus, IconRefresh, IconSettings } from 'twenty-ui/icon';
import { IconButton, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type UniboxTab } from '@/unibox/types/UniboxThread';
import { t } from '@lingui/core/macro';

type UniboxHeaderAccount = { id: string; handle: string };

const StyledActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledTabs = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  padding: 2px;
`;

const StyledTab = styled.button<{ isActive: boolean }>`
  all: unset;
  background: ${({ isActive }) =>
    isActive ? themeCssVariables.background.primary : 'transparent'};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledToggleLabel = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  white-space: nowrap;
`;

const StyledAccount = styled.button<{ isSelected: boolean }>`
  all: unset;
  border: 2px solid
    ${({ isSelected }) =>
      isSelected ? themeCssVariables.color.blue : 'transparent'};
  border-radius: 50%;
  cursor: pointer;
  display: flex;
`;

const StyledIconLink = styled(Link)`
  align-items: center;
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  height: 22px;
  justify-content: center;
  text-decoration: none;
  width: 22px;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

export const UniboxHeaderActions = ({
  tab,
  accounts,
  selectedAccountIds,
  onlyCrmContacts,
  isDraftEnabled,
  onTabChange,
  onToggleAccount,
  onOnlyCrmContactsChange,
  onOpenContacts,
  onRefresh,
}: {
  tab: UniboxTab;
  accounts: UniboxHeaderAccount[];
  selectedAccountIds: string[];
  onlyCrmContacts: boolean;
  isDraftEnabled: boolean;
  onTabChange: (tab: UniboxTab) => void;
  onToggleAccount: (accountId: string) => void;
  onOnlyCrmContactsChange: (value: boolean) => void;
  onOpenContacts: () => void;
  onRefresh: () => void;
}) => {
  return (
    <StyledActions>
      <StyledTabs>
        <StyledTab
          type="button"
          isActive={tab === 'EMAILS'}
          onClick={() => onTabChange('EMAILS')}
        >
          {t`Emails`}
        </StyledTab>
        <StyledTab
          type="button"
          isActive={tab === 'SENT'}
          onClick={() => onTabChange('SENT')}
        >
          {t`Sent`}
        </StyledTab>
        {isDraftEnabled && (
          <StyledTab
            type="button"
            isActive={tab === 'DRAFT'}
            onClick={() => onTabChange('DRAFT')}
          >
            {t`Draft`}
          </StyledTab>
        )}
      </StyledTabs>
      {tab !== 'DRAFT' && (
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
          <AvatarGroup
            avatars={accounts.map((account) => (
              <StyledAccount
                key={account.id}
                type="button"
                isSelected={selectedAccountIds.includes(account.id)}
                aria-label={t`Filter by ${account.handle}`}
                onClick={() => onToggleAccount(account.id)}
              >
                <Avatar
                  placeholder={account.handle}
                  placeholderColorSeed={account.id}
                  size="sm"
                  type="rounded"
                />
              </StyledAccount>
            ))}
          />
        </>
      )}
      <IconButton
        Icon={IconPlus}
        variant="secondary"
        size="small"
        ariaLabel={t`Find contacts`}
        onClick={onOpenContacts}
      />
      <StyledIconLink
        to={getSettingsPath(SettingsPath.Accounts)}
        aria-label={t`Account settings`}
      >
        <IconSettings size={16} />
      </StyledIconLink>
      <IconButton
        Icon={IconRefresh}
        variant="secondary"
        size="small"
        ariaLabel={t`Refresh messages`}
        onClick={onRefresh}
      />
    </StyledActions>
  );
};
