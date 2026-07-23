import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { type SequenceDelayStepSettings } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import {
  StyledActions,
  StyledFieldsGrid,
  StyledField,
  StyledInput,
} from './SequencePageStyles';

type SequenceDelayStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceDelayStepSettings;
  disabled: boolean;
};

const toNonNegativeNumber = (value: string) =>
  Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export const SequenceDelayStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceDelayStepEditorProps) => {
  const [days, setDays] = useState(settings.days);
  const [hours, setHours] = useState(settings.hours);
  const [minutes, setMinutes] = useState(settings.minutes);
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const save = async () => {
    setIsSaving(true);

    try {
      await updateOneRecord<SequenceStepRecord>({
        objectNameSingular: 'sequenceStep',
        idToUpdate: step.id,
        updateOneRecordInput: {
          settings: {
            type: 'DELAY',
            branch: settings.branch,
            days,
            hours,
            minutes,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Delay step saved.` });
    } catch {
      enqueueErrorSnackBar({ message: t`The delay step could not be saved.` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <StyledFieldsGrid>
        <StyledField>
          <span>{t`Days`}</span>
          <StyledInput
            type="number"
            min={0}
            value={days}
            onChange={(event) =>
              setDays(toNonNegativeNumber(event.target.value))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Hours`}</span>
          <StyledInput
            type="number"
            min={0}
            value={hours}
            onChange={(event) =>
              setHours(toNonNegativeNumber(event.target.value))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Minutes`}</span>
          <StyledInput
            type="number"
            min={0}
            value={minutes}
            onChange={(event) =>
              setMinutes(toNonNegativeNumber(event.target.value))
            }
          />
        </StyledField>
      </StyledFieldsGrid>
      <StyledActions>
        <Button
          title={t`Save delay step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={disabled}
        />
      </StyledActions>
    </>
  );
};
