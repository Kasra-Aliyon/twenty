import { useQuery } from '@apollo/client/react';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { GET_MY_CONNECTED_ACCOUNTS } from '@/settings/accounts/graphql/queries/getMyConnectedAccounts';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { getDefaultSequenceSettings } from '@/sequence/constants/default-sequence-settings';
import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import { isSequenceSenderAccount } from '@/sequence/utils/isSequenceSenderAccount';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
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
`;

const StyledToggleRow = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: space-between;
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
  const [settings, setSettings] = useState({
    ...defaults,
    ...sequence.settings,
  });
  const [senderConnectedAccountId, setSenderConnectedAccountId] = useState(
    sequence.senderConnectedAccountId ?? '',
  );
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const { data: accountsData } = useQuery<{
    myConnectedAccounts: SequenceSenderAccount[];
  }>(GET_MY_CONNECTED_ACCOUNTS);

  const accountOptions: SelectOption<string>[] =
    accountsData?.myConnectedAccounts
      .filter(isSequenceSenderAccount)
      .map((account) => ({ label: account.handle, value: account.id })) ?? [];
  const effectiveSenderConnectedAccountId = accountOptions.some(
    (option) => option.value === senderConnectedAccountId,
  )
    ? senderConnectedAccountId
    : (accountOptions[0]?.value ?? '');

  const toggleDay = (day: number) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      activeDays: currentSettings.activeDays.includes(day)
        ? currentSettings.activeDays.filter((activeDay) => activeDay !== day)
        : [...currentSettings.activeDays, day],
    }));
  };

  const save = async () => {
    if (
      !effectiveSenderConnectedAccountId ||
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
          settings,
          senderConnectedAccountId: effectiveSenderConnectedAccountId,
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
              onClick={() => toggleDay(day.value)}
            >
              {day.label}
            </StyledDayButton>
          ))}
        </StyledDayPicker>
      </StyledField>

      <StyledFieldsGrid>
        <StyledField>
          <span>{t`Window starts`}</span>
          <StyledInput
            type="time"
            value={settings.windowStart}
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

      <StyledFieldsGrid>
        <StyledField>
          <span>{t`Daily enrollment starts`}</span>
          <StyledInput
            type="number"
            min={1}
            value={settings.dailyStarts}
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
        {accountOptions.length > 0 && (
          <Select
            dropdownId={`sequence-settings-sender-${sequence.id}`}
            label={t`Sender mailbox`}
            fullWidth
            value={effectiveSenderConnectedAccountId}
            options={accountOptions}
            onChange={setSenderConnectedAccountId}
          />
        )}
      </StyledFieldsGrid>

      {accountOptions.length === 0 && (
        <StyledField>
          <span>{t`Sender mailbox`}</span>
          <span>{t`Connect an email account before activating this sequence.`}</span>
        </StyledField>
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
