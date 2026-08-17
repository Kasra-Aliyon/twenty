import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { LINKEDIN_DAILY_ACTION_LIMITS } from '@/sequence/constants/linkedin-daily-actions';
import { SequenceMailboxMultiSelect } from '@/sequence/components/SequenceMailboxMultiSelect';
import { getDefaultSequenceSettings } from '@/sequence/constants/default-sequence-settings';
import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import { isSequenceSenderAccount } from '@/sequence/utils/isSequenceSenderAccount';
import { useMyConnectedAccounts } from '@/settings/accounts/hooks/useMyConnectedAccounts';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';
import { Button, Toggle, type SelectOption } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceRecord } from '../types/SequenceRecords';
import {
  StyledActions,
  StyledFieldsGrid,
  StyledField,
  StyledInput,
  StyledSection,
  StyledSectionTitle,
} from './SequencePageStyles';

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

const StyledDayPicker = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  grid-template-columns: repeat(7, minmax(44px, 1fr));
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

const StyledToggleRow = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: space-between;
`;

const StyledHelperText = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

type SequenceSettingsSectionProps = {
  sequence: SequenceRecord;
  canUpdate: boolean;
};

export const SequenceSettingsSection = ({
  sequence,
  canUpdate,
}: SequenceSettingsSectionProps) => {
  const defaults = getDefaultSequenceSettings();
  const [settings, setSettings] = useState<SequenceSettings>({
    ...defaults,
    ...sequence.settings,
  });
  const [linkedinDelayPatternText, setLinkedinDelayPatternText] = useState(
    (
      sequence.settings.linkedinDelayPatternMinutes ??
      defaults.linkedinDelayPatternMinutes
    ).join(','),
  );
  const [senderConnectedAccountIds, setSenderConnectedAccountIds] = useState(
    (sequence.settings.senderConnectedAccountIds?.length ?? 0) > 0
      ? (sequence.settings.senderConnectedAccountIds ?? [])
      : sequence.senderConnectedAccountId
        ? [sequence.senderConnectedAccountId]
        : [],
  );
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const { accounts } = useMyConnectedAccounts();

  const accountOptions: SelectOption<string>[] = accounts
    .filter(isSequenceSenderAccount)
    .map((account: SequenceSenderAccount) => ({
      label: account.handle,
      value: account.id,
    }));
  const unavailableSelectedAccountOptions: SelectOption<string>[] =
    senderConnectedAccountIds
      .filter(
        (accountId) =>
          !accountOptions.some((option) => option.value === accountId),
      )
      .map((accountId) => ({
        label: t`Unavailable mailbox (${accountId.slice(0, 8)})`,
        value: accountId,
      }));
  const mailboxOptions = [
    ...accountOptions,
    ...unavailableSelectedAccountOptions,
  ];
  const isRecipientTimezoneMode =
    settings.sendWindowTimezoneMode ===
    SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT;

  const toggleDay = (day: number) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      activeDays: currentSettings.activeDays.includes(day)
        ? currentSettings.activeDays.filter((activeDay) => activeDay !== day)
        : [...currentSettings.activeDays, day],
    }));
  };

  const save = async () => {
    const linkedinDelayPatternParts = linkedinDelayPatternText
      .split(',')
      .map((part) => part.trim());
    const linkedinDelayPatternMinutes = linkedinDelayPatternParts.map(Number);

    if (
      linkedinDelayPatternParts.some((part) => part.length === 0) ||
      linkedinDelayPatternMinutes.length === 0 ||
      linkedinDelayPatternMinutes.some(
        (delay) => !Number.isFinite(delay) || delay <= 0,
      )
    ) {
      enqueueErrorSnackBar({
        message: t`Enter a comma-separated LinkedIn delay pattern using positive numbers.`,
      });
      return;
    }

    if (!isRecipientTimezoneMode) {
      try {
        new Intl.DateTimeFormat('en-US', {
          timeZone: settings.timezone,
        }).format();
      } catch {
        enqueueErrorSnackBar({
          message: t`Enter a valid IANA timezone such as Europe/Helsinki.`,
        });
        return;
      }
    }

    if (
      senderConnectedAccountIds.length === 0 ||
      settings.activeDays.length === 0
    ) {
      enqueueErrorSnackBar({
        message: t`Choose a sender and at least one active day.`,
      });
      return;
    }

    setIsSaving(true);

    try {
      await updateOneRecord<SequenceRecord>({
        objectNameSingular: 'sequence',
        idToUpdate: sequence.id,
        updateOneRecordInput: {
          settings: {
            ...settings,
            linkedinDelayPatternMinutes,
            senderConnectedAccountIds,
          },
          senderConnectedAccountId: senderConnectedAccountIds[0],
        },
      });
      enqueueSuccessSnackBar({ message: t`Sequence settings saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence settings could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <StyledSection>
      <StyledSectionTitle>{t`Sending schedule`}</StyledSectionTitle>

      <StyledField>
        <span>{t`Active days`}</span>
        <StyledDayPicker>
          {WEEK_DAYS.map((day) => (
            <StyledDayButton
              key={day.value}
              type="button"
              isSelected={settings.activeDays.includes(day.value)}
              aria-pressed={settings.activeDays.includes(day.value)}
              disabled={!canUpdate}
              onClick={() => toggleDay(day.value)}
            >
              {day.label}
            </StyledDayButton>
          ))}
        </StyledDayPicker>
      </StyledField>

      <StyledFieldsGrid>
        <Select
          dropdownId={`sequence-settings-timezone-mode-${sequence.id}`}
          label={t`Apply sending hours in`}
          fullWidth
          value={settings.sendWindowTimezoneMode}
          options={SEND_WINDOW_TIMEZONE_MODE_OPTIONS}
          disabled={!canUpdate}
          onChange={(sendWindowTimezoneMode) =>
            setSettings((currentSettings) => ({
              ...currentSettings,
              sendWindowTimezoneMode,
            }))
          }
        />
        <StyledField>
          <span>{t`Window starts`}</span>
          <StyledInput
            type="time"
            value={settings.windowStart}
            disabled={!canUpdate}
            onChange={(event) =>
              setSettings((currentSettings) => ({
                ...currentSettings,
                windowStart: event.target.value,
              }))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Window ends`}</span>
          <StyledInput
            type="time"
            value={settings.windowEnd}
            disabled={!canUpdate}
            onChange={(event) =>
              setSettings((currentSettings) => ({
                ...currentSettings,
                windowEnd: event.target.value,
              }))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Timezone`}</span>
          <StyledInput
            value={settings.timezone}
            disabled={!canUpdate || isRecipientTimezoneMode}
            onChange={(event) =>
              setSettings((currentSettings) => ({
                ...currentSettings,
                timezone: event.target.value,
              }))
            }
            placeholder="Europe/Helsinki"
          />
        </StyledField>
      </StyledFieldsGrid>
      <StyledHelperText>
        {isRecipientTimezoneMode
          ? t`The selected days and hours use the Time zone field on each recipient's Person record. Missing or invalid values fall back to UTC.`
          : t`The selected days and hours use the sequence time zone.`}
      </StyledHelperText>

      <StyledToggleRow>
        <span>{t`Enforce daily enrollment start cap`}</span>
        <Toggle
          value={settings.dailyStartLimitEnabled}
          onChange={(dailyStartLimitEnabled) =>
            setSettings((currentSettings) => ({
              ...currentSettings,
              dailyStartLimitEnabled,
            }))
          }
          toggleSize="small"
        />
      </StyledToggleRow>

      <StyledFieldsGrid>
        <StyledField>
          <span>{t`Daily enrollment starts`}</span>
          <StyledInput
            type="number"
            min={1}
            value={settings.dailyStarts}
            disabled={!settings.dailyStartLimitEnabled}
            onChange={(event) =>
              setSettings((currentSettings) => ({
                ...currentSettings,
                dailyStarts: Math.max(1, Number(event.target.value) || 1),
              }))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Minutes between sends`}</span>
          <StyledInput
            type="number"
            min={0}
            value={settings.staggerMinutes}
            onChange={(event) =>
              setSettings((currentSettings) => ({
                ...currentSettings,
                staggerMinutes: Math.max(0, Number(event.target.value) || 0),
              }))
            }
          />
        </StyledField>
        {mailboxOptions.length > 0 && (
          <StyledField>
            <span>{t`Sender mailbox pool`}</span>
            <SequenceMailboxMultiSelect
              dropdownId={`sequence-settings-sender-pool-${sequence.id}`}
              options={mailboxOptions}
              selectedAccountIds={senderConnectedAccountIds}
              disabled={!canUpdate}
              onChange={setSenderConnectedAccountIds}
            />
          </StyledField>
        )}
      </StyledFieldsGrid>
      <StyledHelperText>
        {settings.dailyStartLimitEnabled
          ? isRecipientTimezoneMode
            ? t`Pending enrollments are admitted up to this cap per UTC day.`
            : t`Pending enrollments are admitted up to this cap per day in the sequence time zone.`
          : t`Testing mode: pending enrollments are admitted without a daily cap, in scheduler batches.`}
      </StyledHelperText>

      {mailboxOptions.length === 0 && (
        <StyledField>
          <span>{t`Sender mailbox pool`}</span>
          <span>{t`Connect an email account and wait for inbox sync to finish before activating this sequence.`}</span>
        </StyledField>
      )}

      {mailboxOptions.length > 0 && (
        <StyledHelperText>
          {t`Choose up to 20 mailboxes. Each contact is assigned one mailbox for the full sequence so replies and follow-ups stay in the same thread.`}
        </StyledHelperText>
      )}

      <StyledToggleRow>
        <span>{t`Automatically stop an enrollment when the contact replies`}</span>
        <Toggle
          value={settings.stopOnReply}
          onChange={(stopOnReply) =>
            setSettings((currentSettings) => ({
              ...currentSettings,
              stopOnReply,
            }))
          }
          toggleSize="small"
        />
      </StyledToggleRow>

      <StyledSectionTitle>{t`LinkedIn`}</StyledSectionTitle>
      <StyledToggleRow>
        <span>{t`Enforce daily LinkedIn action cap`}</span>
        <Toggle
          value={settings.linkedinDailyActionLimitEnabled}
          onChange={(linkedinDailyActionLimitEnabled) =>
            setSettings((currentSettings) => ({
              ...currentSettings,
              linkedinDailyActionLimitEnabled,
            }))
          }
          toggleSize="small"
        />
      </StyledToggleRow>
      <StyledFieldsGrid>
        <StyledField>
          <span>{t`Daily LinkedIn actions`}</span>
          <StyledInput
            type="number"
            min={LINKEDIN_DAILY_ACTION_LIMITS.MINIMUM}
            max={LINKEDIN_DAILY_ACTION_LIMITS.MAXIMUM}
            value={settings.linkedinDailyActions}
            disabled={!settings.linkedinDailyActionLimitEnabled}
            onChange={(event) =>
              setSettings((currentSettings) => ({
                ...currentSettings,
                linkedinDailyActions: Math.max(
                  LINKEDIN_DAILY_ACTION_LIMITS.MINIMUM,
                  Math.min(
                    LINKEDIN_DAILY_ACTION_LIMITS.MAXIMUM,
                    Number(event.target.value) ||
                      LINKEDIN_DAILY_ACTION_LIMITS.MINIMUM,
                  ),
                ),
              }))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Delay pattern in minutes`}</span>
          <StyledInput
            value={linkedinDelayPatternText}
            onChange={(event) =>
              setLinkedinDelayPatternText(event.target.value)
            }
            placeholder="1,3,5,2,8,4,6"
          />
        </StyledField>
      </StyledFieldsGrid>
      <StyledHelperText>
        {settings.linkedinDailyActionLimitEnabled
          ? t`The daily action cap, sending window, and delay pattern are enforced.`
          : t`Testing mode: only the daily action cap is off. The sending window and delay pattern remain enforced.`}
      </StyledHelperText>

      <StyledActions>
        <Button
          title={t`Save settings`}
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={!canUpdate}
        />
      </StyledActions>
    </StyledSection>
  );
};
