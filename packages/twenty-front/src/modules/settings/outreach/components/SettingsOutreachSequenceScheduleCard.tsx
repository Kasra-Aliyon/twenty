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
    <Card rounded>
      <CardContent divider>
        <StyledScheduleHeader>
          <StyledSettingText>
            <StyledSettingTitle>{t`Sending days`}</StyledSettingTitle>
            <StyledSettingDescription>
              {isRecipientTimezoneMode
                ? t`The scheduler applies these days and hours using the Time zone field on each recipient's Person record. Missing or invalid values fall back to UTC.`
                : t`The scheduler admits contacts and creates outbound actions only on the selected days and hours in the sequence time zone.`}
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
      <CardContent>
        <StyledScheduleFields>
          <Select
            dropdownId="outreach-sequence-timezone-mode"
            label={t`Apply sending hours in`}
            fullWidth
            value={settings.sendWindowTimezoneMode}
            options={SEND_WINDOW_TIMEZONE_MODE_OPTIONS}
            disabled={disabled}
            onChange={(sendWindowTimezoneMode) =>
              onChange({ sendWindowTimezoneMode })
            }
          />
          <SettingsTextInput
            instanceId="outreach-sequence-window-start"
            label={t`Window starts`}
            type="time"
            value={settings.windowStart}
            disabled={disabled}
            onChange={(windowStart) => onChange({ windowStart })}
          />
          <SettingsTextInput
            instanceId="outreach-sequence-window-end"
            label={t`Window ends`}
            type="time"
            value={settings.windowEnd}
            disabled={disabled}
            onChange={(windowEnd) => onChange({ windowEnd })}
          />
          <SettingsTextInput
            instanceId="outreach-sequence-timezone"
            label={t`Timezone`}
            value={settings.timezone}
            placeholder="Europe/Helsinki"
            disabled={disabled || isRecipientTimezoneMode}
            onChange={(timezone) => onChange({ timezone })}
          />
        </StyledScheduleFields>
      </CardContent>
    </Card>
  );
};
