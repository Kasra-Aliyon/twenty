import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { type SequenceWithdrawConnectionRequestStepSettings } from 'twenty-shared/types';
import { Button } from 'twenty-ui/input';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import {
  StyledActions,
  StyledFieldsGrid,
  StyledField,
  StyledInput,
} from './SequencePageStyles';

type SequenceWithdrawConnectionRequestStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceWithdrawConnectionRequestStepSettings;
  disabled: boolean;
};

const toNonNegativeNumber = (value: string) =>
  Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export const SequenceWithdrawConnectionRequestStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceWithdrawConnectionRequestStepEditorProps) => {
  const [withdrawAfterDays, setWithdrawAfterDays] = useState(
    settings.withdrawAfterDays,
  );
  const [withdrawAfterHours, setWithdrawAfterHours] = useState(
    settings.withdrawAfterHours,
  );
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
            type: 'WITHDRAW_CONNECTION_REQUEST',
            withdrawAfterDays,
            withdrawAfterHours,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Withdrawal step saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The withdrawal step could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <StyledFieldsGrid>
        <StyledField>
          <span>{t`Withdraw after days`}</span>
          <StyledInput
            type="number"
            min={0}
            value={withdrawAfterDays}
            onChange={(event) =>
              setWithdrawAfterDays(toNonNegativeNumber(event.target.value))
            }
          />
        </StyledField>
        <StyledField>
          <span>{t`Additional hours`}</span>
          <StyledInput
            type="number"
            min={0}
            value={withdrawAfterHours}
            onChange={(event) =>
              setWithdrawAfterHours(toNonNegativeNumber(event.target.value))
            }
          />
        </StyledField>
      </StyledFieldsGrid>
      <StyledActions>
        <Button
          title={t`Save withdrawal step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={disabled}
        />
      </StyledActions>
    </>
  );
};
