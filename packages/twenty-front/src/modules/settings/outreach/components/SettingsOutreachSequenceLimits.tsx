import { useState } from 'react';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { getDefaultSequenceSettings } from '@/sequence/constants/default-sequence-settings';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
  type SequenceSettings,
} from 'twenty-shared/types';
import { Button, type SelectOption } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { H2Title } from 'twenty-ui/typography';

import { type SequenceRecord } from '~/pages/sequence/types/SequenceRecords';

import { StyledActionRow, StyledNotice } from './SettingsOutreachStyles';
import { SettingsOutreachSequenceLimitCard } from './SettingsOutreachSequenceLimitCard';
import { SettingsOutreachSequenceScheduleCard } from './SettingsOutreachSequenceScheduleCard';

const SEQUENCE_LIMIT = 100;

export const SettingsOutreachSequenceLimits = () => {
  const [selectedSequenceId, setSelectedSequenceId] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<SequenceSettings | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const {
    objectMetadataItem,
    records: sequences,
    refetch,
    loading,
  } = useFindManyRecords<SequenceRecord>({
    objectNameSingular: 'sequence',
    orderBy: [{ name: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      name: true,
      status: true,
      settings: true,
    },
    limit: SEQUENCE_LIMIT,
  });
  const sequencePermissions = useObjectPermissionsForObject(
    objectMetadataItem.id,
  );
  const selectedSequence =
    sequences.find((sequence) => sequence.id === selectedSequenceId) ??
    sequences[0];
  const effectiveSettings =
    settingsDraft ??
    (selectedSequence !== undefined
      ? {
          ...getDefaultSequenceSettings(),
          ...selectedSequence.settings,
        }
      : null);
  const sequenceOptions: SelectOption<string>[] = sequences.map((sequence) => ({
    label: sequence.name,
    value: sequence.id,
  }));
  const canUpdateSequenceSettings =
    selectedSequence !== undefined &&
    selectedSequence.status !== SEQUENCE_STATUSES.ACTIVE &&
    sequencePermissions.canUpdateObjectRecords;

  const selectSequence = (sequenceId: string) => {
    const sequence = sequences.find(({ id }) => id === sequenceId);

    setSelectedSequenceId(sequenceId);
    setSettingsDraft(
      sequence !== undefined
        ? {
            ...getDefaultSequenceSettings(),
            ...sequence.settings,
          }
        : null,
    );
  };

  const updateSettingsDraft = (update: Partial<SequenceSettings>) => {
    if (effectiveSettings === null) {
      return;
    }

    setSettingsDraft({
      ...effectiveSettings,
      ...update,
    });
  };

  const save = async () => {
    if (
      selectedSequence === undefined ||
      effectiveSettings === null ||
      !canUpdateSequenceSettings
    ) {
      return;
    }

    if (
      effectiveSettings.sendWindowTimezoneMode ===
      SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE
    ) {
      try {
        new Intl.DateTimeFormat('en-US', {
          timeZone: effectiveSettings.timezone,
        }).format();
      } catch {
        enqueueErrorSnackBar({
          message: t`Enter a valid IANA timezone such as Europe/Helsinki.`,
        });
        return;
      }
    }

    if (effectiveSettings.activeDays.length === 0) {
      enqueueErrorSnackBar({
        message: t`Choose at least one active day.`,
      });
      return;
    }

    setIsSaving(true);

    try {
      await updateOneRecord<SequenceRecord>({
        objectNameSingular: 'sequence',
        idToUpdate: selectedSequence.id,
        updateOneRecordInput: {
          settings: effectiveSettings,
        },
      });
      await refetch();
      setSettingsDraft(null);
      enqueueSuccessSnackBar({
        message: t`Sequence schedule and limits saved.`,
      });
    } catch (error) {
      enqueueErrorSnackBar({
        message: CombinedGraphQLErrors.is(error)
          ? (error.errors[0]?.message ??
            t`The sequence settings could not be saved.`)
          : t`The sequence settings could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section>
      <H2Title
        title={t`Sequence schedule and limits`}
        description={t`Choose a sequence and control when it runs, how quickly contacts enter it, and how many LinkedIn actions it schedules.`}
      />
      {sequenceOptions.length > 0 ? (
        <>
          <Select
            dropdownId="outreach-settings-sequence"
            label={t`Sequence`}
            fullWidth
            value={selectedSequence?.id ?? ''}
            options={sequenceOptions}
            onChange={selectSequence}
          />
          {effectiveSettings !== null && (
            <>
              <SettingsOutreachSequenceScheduleCard
                settings={effectiveSettings}
                disabled={!canUpdateSequenceSettings}
                onChange={updateSettingsDraft}
              />
              <SettingsOutreachSequenceLimitCard
                settings={effectiveSettings}
                disabled={!canUpdateSequenceSettings}
                onChange={updateSettingsDraft}
              />
            </>
          )}
          {!canUpdateSequenceSettings && selectedSequence !== undefined && (
            <StyledNotice>
              {selectedSequence.status === SEQUENCE_STATUSES.ACTIVE
                ? t`Pause this sequence before changing its schedule or limits.`
                : t`You do not have permission to update this sequence.`}
            </StyledNotice>
          )}
          <StyledActionRow>
            <Button
              title={t`Save schedule and limits`}
              onClick={() => void save()}
              isLoading={isSaving}
              disabled={!canUpdateSequenceSettings}
            />
          </StyledActionRow>
        </>
      ) : (
        <StyledNotice>
          {loading
            ? t`Loading sequences…`
            : t`Create a sequence before configuring sequence limits.`}
        </StyledNotice>
      )}
    </Section>
  );
};
