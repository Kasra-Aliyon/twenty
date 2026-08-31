import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';
import { type SelectOption } from 'twenty-ui/input';
import { Card, CardContent } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';

import { Select } from '@/ui/input/components/Select';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';

import {
  StyledSettingDescription,
  StyledSettingText,
  StyledSettingTitle,
} from './SettingsOutreachStyles';

const WEEK_DAYS = [
  { value: 1, label: t`Mon` },
  { value: 2, label: t`Tue` },
  { value: 3, label: t`Wed` },
  { value: 4, label: t`Thu` },
  { value: 5, label: t`Fri` },
  { value: 6, label: t`Sat` },
  { value: 0, label: t`Sun` },
] as const;

type SendWindowTimezoneMode =
  (typeof SEQUENCE_SEND_WINDOW_TIMEZONE_MODES)[keyof typeof SEQUENCE_SEND_WINDOW_TIMEZONE_MODES];

const SEND_WINDOW_TIMEZONE_MODE_OPTIONS: SelectOption<SendWindowTimezoneMode>[] =
  [
    {
      value: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
      label: t`Sequence time zone`,
    },
    {
      value: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      label: t`Each recipient's time zone`,
    },
  ];

const StyledScheduleHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledScheduleCards = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledWindowSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledDayPicker = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  grid-template-columns: repeat(7, minmax(40px, 1fr));
`;

const StyledDayButton = styled.button<{ isSelected: boolean }>`
  background: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.background.transparent.medium
      : themeCssVariables.background.transparent.lighter};
  border: 1px solid
    ${({ isSelected }) =>
      isSelected
        ? themeCssVariables.border.color.strong
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  height: 32px;

  &:disabled {
    color: ${themeCssVariables.font.color.tertiary};
    cursor: not-allowed;
  }
`;

const StyledScheduleFields = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  width: 100%;
`;

type SettingsOutreachSequenceScheduleCardProps = {
  settings: SequenceSettings;
  disabled: boolean;
  onChange: (update: Partial<SequenceSettings>) => void;
};

export const SettingsOutreachSequenceScheduleCard = ({
  settings,
  disabled,
  onChange,
}: SettingsOutreachSequenceScheduleCardProps) => {
  const isRecipientTimezoneMode =
    settings.sendWindowTimezoneMode ===
    SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT;

  const toggleDay = (day: number) => {
    onChange({
      activeDays: settings.activeDays.includes(day)
        ? settings.activeDays.filter((activeDay) => activeDay !== day)
        : [...settings.activeDays, day],
    });
  };

  return (
    <StyledScheduleCards>
      <Card rounded>
        <CardContent>
          <StyledScheduleHeader>
            <StyledSettingText>
              <StyledSettingTitle>{t`Shared sending days`}</StyledSettingTitle>
              <StyledSettingDescription>
                {t`These days apply to both the LinkedIn and other task schedule and the email sending schedule.`}
              </StyledSettingDescription>
            </StyledSettingText>
            <StyledDayPicker>
              {WEEK_DAYS.map((day) => (
                <StyledDayButton
                  key={day.value}
                  type="button"
                  isSelected={settings.activeDays.includes(day.value)}
                  aria-pressed={settings.activeDays.includes(day.value)}
                  disabled={disabled}
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </StyledDayButton>
              ))}
            </StyledDayPicker>
          </StyledScheduleHeader>
        </CardContent>
      </Card>
      <Card rounded>
        <CardContent>
          <StyledWindowSection>
            <StyledSettingText>
              <StyledSettingTitle>{t`LinkedIn and other tasks`}</StyledSettingTitle>
              <StyledSettingDescription>
                {t`Controls enrollment admission, LinkedIn steps, calls, and other non-email tasks in the sequence time zone.`}
              </StyledSettingDescription>
            </StyledSettingText>
            <StyledScheduleFields>
              <SettingsTextInput
                instanceId="outreach-sequence-window-start"
                label={t`LinkedIn and task window starts`}
                type="time"
                value={settings.windowStart}
                disabled={disabled}
                onChange={(windowStart) => onChange({ windowStart })}
              />
              <SettingsTextInput
                instanceId="outreach-sequence-window-end"
                label={t`LinkedIn and task window ends`}
                type="time"
                value={settings.windowEnd}
                disabled={disabled}
                onChange={(windowEnd) => onChange({ windowEnd })}
              />
              <SettingsTextInput
                instanceId="outreach-sequence-timezone"
                label={t`Sequence time zone`}
                value={settings.timezone}
                placeholder="Europe/Helsinki"
                disabled={disabled}
                onChange={(timezone) => onChange({ timezone })}
              />
            </StyledScheduleFields>
          </StyledWindowSection>
        </CardContent>
      </Card>
      <Card rounded>
        <CardContent>
          <StyledWindowSection>
            <StyledSettingText>
              <StyledSettingTitle>{t`Email sending`}</StyledSettingTitle>
              <StyledSettingDescription>
                {isRecipientTimezoneMode
                  ? t`Controls automated email delivery and manual email task surfacing in each recipient's Person time zone. Missing or invalid values fall back to UTC.`
                  : t`Controls automated email delivery and manual email task surfacing in the sequence time zone.`}
              </StyledSettingDescription>
            </StyledSettingText>
            <StyledScheduleFields>
              <SettingsTextInput
                instanceId="outreach-sequence-email-window-start"
                label={t`Email window starts`}
                type="time"
                value={settings.emailWindowStart ?? settings.windowStart}
                disabled={disabled}
                onChange={(emailWindowStart) => onChange({ emailWindowStart })}
              />
              <SettingsTextInput
                instanceId="outreach-sequence-email-window-end"
                label={t`Email window ends`}
                type="time"
                value={settings.emailWindowEnd ?? settings.windowEnd}
                disabled={disabled}
                onChange={(emailWindowEnd) => onChange({ emailWindowEnd })}
              />
              <Select
                dropdownId="outreach-sequence-timezone-mode"
                label={t`Apply email window in`}
                fullWidth
                value={settings.sendWindowTimezoneMode}
                options={SEND_WINDOW_TIMEZONE_MODE_OPTIONS}
                disabled={disabled}
                onChange={(sendWindowTimezoneMode) =>
                  onChange({ sendWindowTimezoneMode })
                }
              />
            </StyledScheduleFields>
          </StyledWindowSection>
        </CardContent>
      </Card>
    </StyledScheduleCards>
  );
};
