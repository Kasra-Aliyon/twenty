import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_CONDITION_TYPES,
  type SequenceConditionStepSettings,
  type SequenceConditionType,
} from 'twenty-shared/types';
import { Button, type SelectOption } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { getSequenceConditionLabel } from '../utils/get-sequence-step-presentation';
import { StyledActions, StyledFieldsGrid } from './SequencePageStyles';

const CONDITION_OPTIONS: SelectOption<SequenceConditionType>[] = Object.values(
  SEQUENCE_CONDITION_TYPES,
).map((condition) => ({
  value: condition,
  label: getSequenceConditionLabel(condition),
}));

const StyledBranchHint = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.5;
  padding: ${themeCssVariables.spacing[3]};
`;

type SequenceConditionStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceConditionStepSettings;
  disabled: boolean;
};

export const SequenceConditionStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceConditionStepEditorProps) => {
  const [condition, setCondition] = useState(settings.condition);
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
            type: 'CONDITION',
            condition,
            branch: settings.branch,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Condition saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The condition could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <StyledFieldsGrid>
        <Select
          dropdownId={`sequence-condition-${step.id}`}
          label={t`Contact condition`}
          fullWidth
          value={condition}
          options={CONDITION_OPTIONS}
          onChange={setCondition}
        />
        <StyledBranchHint>
          {t`Contacts matching this condition continue through Yes. Everyone else continues through No. Both paths merge back into the main sequence.`}
        </StyledBranchHint>
      </StyledFieldsGrid>
      <StyledActions>
        <Button
          title={t`Save condition`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={disabled}
        />
      </StyledActions>
    </>
  );
};
