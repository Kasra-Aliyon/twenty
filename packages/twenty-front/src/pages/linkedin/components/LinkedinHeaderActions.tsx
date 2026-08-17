import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { Link } from 'react-router-dom';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { IconRefresh, IconSettings } from 'twenty-ui/icon';
import { IconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
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

export const LinkedinHeaderActions = ({
  onRefresh,
}: {
  onRefresh: () => void;
}) => (
  <StyledActions>
    <StyledIconLink
      to={getSettingsPath(SettingsPath.Accounts)}
      aria-label={t`LinkedIn account settings`}
    >
      <IconSettings size={16} />
    </StyledIconLink>
    <IconButton
      Icon={IconRefresh}
      variant="secondary"
      size="small"
      ariaLabel={t`Refresh LinkedIn data`}
      onClick={onRefresh}
    />
  </StyledActions>
);
