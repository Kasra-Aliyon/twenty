import { useState } from 'react';

import { SettingsCounter } from '@/settings/components/SettingsCounter';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { t } from '@lingui/core/macro';
import { Button, Toggle } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { Card, CardContent } from 'twenty-ui/surfaces';
import { H2Title } from 'twenty-ui/typography';

import {
  LINKEDIN_DAILY_READ_LIMIT_MAXIMUM,
  LINKEDIN_DAILY_READ_LIMIT_MINIMUM,
  readLinkedInBrowserSafetySettings,
  saveLinkedInBrowserSafetySettings,
} from '../utils/linkedinBrowserSafetySettings';
import {
  StyledActionRow,
  StyledNotice,
  StyledSettingDescription,
  StyledSettingRow,
  StyledSettingText,
  StyledSettingTitle,
} from './SettingsOutreachStyles';

export const SettingsOutreachBrowserSync = () => {
  const [settings, setSettings] = useState(readLinkedInBrowserSafetySettings);
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const save = () => {
    try {
      const savedSettings = saveLinkedInBrowserSafetySettings(settings);

      setSettings(savedSettings);
      enqueueSuccessSnackBar({
        message: t`LinkedIn browser sync limit saved.`,
      });
    } catch {
      enqueueErrorSnackBar({
        message: t`The LinkedIn browser sync limit could not be saved.`,
      });
    }
  };

  return (
    <Section>
      <H2Title
        title={t`LinkedIn browser sync`}
        description={t`Control the daily read budget used by the LinkedIn extension on this browser.`}
      />
      <Card rounded>
        <CardContent divider>
          <StyledSettingRow>
            <StyledSettingText>
              <StyledSettingTitle>
                {t`Enforce daily read limit`}
              </StyledSettingTitle>
              <StyledSettingDescription>
                {t`Stops new LinkedIn reads when this browser reaches its daily budget.`}
              </StyledSettingDescription>
            </StyledSettingText>
            <Toggle
              value={settings.dailyReadLimitEnabled}
              onChange={(dailyReadLimitEnabled) =>
                setSettings((currentSettings) => ({
                  ...currentSettings,
                  dailyReadLimitEnabled,
                }))
              }
            />
          </StyledSettingRow>
        </CardContent>
        <CardContent>
          <StyledSettingRow>
            <StyledSettingText>
              <StyledSettingTitle>{t`Daily read limit`}</StyledSettingTitle>
              <StyledSettingDescription>
                {t`Choose between 1 and 200 requests. The always-on hourly limit remains 60.`}
              </StyledSettingDescription>
            </StyledSettingText>
            <SettingsCounter
              value={settings.dailyReadLimit}
              minValue={LINKEDIN_DAILY_READ_LIMIT_MINIMUM}
              maxValue={LINKEDIN_DAILY_READ_LIMIT_MAXIMUM}
              disabled={!settings.dailyReadLimitEnabled}
              showButtons={false}
              onChange={(dailyReadLimit) =>
                setSettings((currentSettings) => ({
                  ...currentSettings,
                  dailyReadLimit,
                }))
              }
            />
          </StyledSettingRow>
        </CardContent>
      </Card>
      <StyledNotice>
        {t`This setting is browser-specific. After saving, keep Twenty open for a few seconds so the installed extension can apply it.`}
      </StyledNotice>
      <StyledActionRow>
        <Button title={t`Save browser limit`} onClick={save} />
      </StyledActionRow>
    </Section>
  );
};
