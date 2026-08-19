import { LINKEDIN_DAILY_ACTION_LIMITS } from '@/sequence/constants/linkedin-daily-actions';
import { SettingsCounter } from '@/settings/components/SettingsCounter';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';
import { Toggle } from 'twenty-ui/input';
import { Card, CardContent } from 'twenty-ui/surfaces';

import {
  StyledSettingDescription,
  StyledSettingRow,
  StyledSettingText,
  StyledSettingTitle,
} from './SettingsOutreachStyles';

type SettingsOutreachSequenceLimitCardProps = {
  settings: SequenceSettings;
  disabled: boolean;
  onChange: (update: Partial<SequenceSettings>) => void;
};

export const SettingsOutreachSequenceLimitCard = ({
  settings,
  disabled,
  onChange,
}: SettingsOutreachSequenceLimitCardProps) => (
  <Card rounded>
    <CardContent divider>
      <StyledSettingRow>
        <StyledSettingText>
          <StyledSettingTitle>
            {t`Enforce daily enrollment admission limit`}
          </StyledSettingTitle>
          <StyledSettingDescription>
            {t`Limits how many pending contacts become active in this sequence each day.`}
          </StyledSettingDescription>
        </StyledSettingText>
        <Toggle
          value={settings.dailyStartLimitEnabled}
          disabled={disabled}
          onChange={(dailyStartLimitEnabled) =>
            onChange({ dailyStartLimitEnabled })
          }
        />
      </StyledSettingRow>
    </CardContent>
    <CardContent divider>
      <StyledSettingRow>
        <StyledSettingText>
          <StyledSettingTitle>{t`Daily enrollment admissions`}</StyledSettingTitle>
          <StyledSettingDescription>
            {settings.sendWindowTimezoneMode ===
            SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT
              ? t`Contacts allowed to move from pending to active per UTC day.`
              : t`Contacts allowed to move from pending to active per day in the sequence time zone.`}
          </StyledSettingDescription>
        </StyledSettingText>
        <SettingsCounter
          value={settings.dailyStarts}
          minValue={1}
          disabled={disabled || !settings.dailyStartLimitEnabled}
          showButtons={false}
          onChange={(dailyStarts) => onChange({ dailyStarts })}
        />
      </StyledSettingRow>
    </CardContent>
    <CardContent divider>
      <StyledSettingRow>
        <StyledSettingText>
          <StyledSettingTitle>
            {t`Enforce daily LinkedIn action limit`}
          </StyledSettingTitle>
          <StyledSettingDescription>
            {t`Applies the sender's per-account LinkedIn action counter when scheduling this sequence.`}
          </StyledSettingDescription>
        </StyledSettingText>
        <Toggle
          value={settings.linkedinDailyActionLimitEnabled}
          disabled={disabled}
          onChange={(linkedinDailyActionLimitEnabled) =>
            onChange({ linkedinDailyActionLimitEnabled })
          }
        />
      </StyledSettingRow>
    </CardContent>
    <CardContent>
      <StyledSettingRow>
        <StyledSettingText>
          <StyledSettingTitle>{t`LinkedIn actions per day`}</StyledSettingTitle>
          <StyledSettingDescription>
            {t`LinkedIn action slots reserved per UTC day for this account, between 1 and 40.`}
          </StyledSettingDescription>
        </StyledSettingText>
        <SettingsCounter
          value={settings.linkedinDailyActions}
          minValue={LINKEDIN_DAILY_ACTION_LIMITS.MINIMUM}
          maxValue={LINKEDIN_DAILY_ACTION_LIMITS.MAXIMUM}
          disabled={disabled || !settings.linkedinDailyActionLimitEnabled}
          showButtons={false}
          onChange={(linkedinDailyActions) =>
            onChange({ linkedinDailyActions })
          }
        />
      </StyledSettingRow>
    </CardContent>
  </Card>
);
