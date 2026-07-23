import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  SEQUENCE_CONDITION_BRANCHES,
  type SequenceConditionBranch,
  type SequenceStepBranch,
} from 'twenty-shared/types';
import { IconArrowMerge, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { SequenceStepCard } from './SequenceStepCard';
import {
  SequenceStepPalette,
  type SequenceStepPaletteOption,
} from './SequenceStepPalette';

const StyledBranchFlow = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  margin-top: ${themeCssVariables.spacing[6]};
  max-width: 760px;
  width: 100%;
`;

const StyledBranches = styled.div`
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(260px, 1fr);
  position: relative;
  width: 100%;
`;

const StyledSplitStem = styled.div`
  background: ${themeCssVariables.border.color.strong};
  height: ${themeCssVariables.spacing[6]};
  left: 50%;
  position: absolute;
  top: -${themeCssVariables.spacing[6]};
  width: 1px;
`;

const StyledSplitRail = styled.div`
  background: ${themeCssVariables.border.color.strong};
  height: 1px;
  left: 25%;
  position: absolute;
  right: 25%;
  top: 0;
`;

const StyledMergeRail = styled.div`
  background: ${themeCssVariables.border.color.strong};
  bottom: 0;
  height: 1px;
  left: 25%;
  position: absolute;
  right: 25%;
`;

const StyledLane = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  min-height: 180px;
  padding: 0 ${themeCssVariables.spacing[3]};
  position: relative;
`;

const StyledLaneConnector = styled.div`
  background: ${themeCssVariables.border.color.strong};
  height: 28px;
  width: 1px;
`;

const StyledLaneToMergeConnector = styled.div`
  background: ${themeCssVariables.border.color.strong};
  flex: 1;
  min-height: ${themeCssVariables.spacing[6]};
  width: 1px;
`;

const StyledOutcome = styled.span<{ outcome: SequenceConditionBranch }>`
  background: ${({ outcome }) =>
    outcome === SEQUENCE_CONDITION_BRANCHES.YES
      ? themeCssVariables.tag.background.green
      : themeCssVariables.tag.background.red};
  border: 1px solid
    ${({ outcome }) =>
      outcome === SEQUENCE_CONDITION_BRANCHES.YES
        ? themeCssVariables.tag.text.green
        : themeCssVariables.tag.text.red};
  border-radius: ${themeCssVariables.border.radius.pill};
  color: ${({ outcome }) =>
    outcome === SEQUENCE_CONDITION_BRANCHES.YES
      ? themeCssVariables.tag.text.green
      : themeCssVariables.tag.text.red};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin-top: -14px;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[4]};
  position: relative;
  z-index: 1;
`;

const StyledMergeStem = styled.div`
  background: ${themeCssVariables.border.color.strong};
  height: ${themeCssVariables.spacing[4]};
  width: 1px;
`;

const StyledMergeNode = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.pill};
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[3]};
`;

const StyledMergeCaption = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledBranchStep = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  max-width: 330px;
  width: 100%;
`;

const isSameBranch = (
  firstBranch: SequenceStepBranch | null,
  secondBranch: SequenceStepBranch,
) =>
  firstBranch?.conditionStepId === secondBranch.conditionStepId &&
  firstBranch.outcome === secondBranch.outcome;

type SequenceConditionBranchesProps = {
  conditionStepId: string;
  steps: SequenceStepRecord[];
  selectedStepId: string | null;
  openPaletteBranch: SequenceStepBranch | null;
  isAddingStep: boolean;
  canAddOrReorder: boolean;
  canDeleteSteps: boolean;
  onSelectStep: (stepId: string) => void;
  onOpenPalette: (branch: SequenceStepBranch) => void;
  onClosePalette: () => void;
  onAddStep: (
    option: SequenceStepPaletteOption,
    branch: SequenceStepBranch,
  ) => Promise<void>;
  onSwapSteps: (
    firstStep: SequenceStepRecord,
    secondStep: SequenceStepRecord,
  ) => Promise<void>;
  onDeleted: (stepId: string) => Promise<void>;
};

export const SequenceConditionBranches = ({
  conditionStepId,
  steps,
  selectedStepId,
  openPaletteBranch,
  isAddingStep,
  canAddOrReorder,
  canDeleteSteps,
  onSelectStep,
  onOpenPalette,
  onClosePalette,
  onAddStep,
  onSwapSteps,
  onDeleted,
}: SequenceConditionBranchesProps) => {
  const renderLane = (outcome: SequenceConditionBranch) => {
    const branch = { conditionStepId, outcome };
    const branchSteps = steps.filter(
      (step) =>
        step.settings.branch?.conditionStepId === conditionStepId &&
        step.settings.branch.outcome === outcome,
    );
    const isPaletteOpen = isSameBranch(openPaletteBranch, branch);

    return (
      <StyledLane key={outcome}>
        <StyledOutcome outcome={outcome}>
          {outcome === SEQUENCE_CONDITION_BRANCHES.YES ? t`Yes` : t`No`}
        </StyledOutcome>
        {branchSteps.map((step, index) => (
          <StyledBranchStep key={step.id}>
            <StyledLaneConnector />
            <SequenceStepCard
              step={step}
              stepNumber={steps.findIndex(({ id }) => id === step.id) + 1}
              isSelected={step.id === selectedStepId}
              canMoveUp={canAddOrReorder && index > 0}
              canMoveDown={canAddOrReorder && index < branchSteps.length - 1}
              canDelete={canDeleteSteps}
              onSelect={() => onSelectStep(step.id)}
              onMoveUp={() => onSwapSteps(step, branchSteps[index - 1])}
              onMoveDown={() => onSwapSteps(step, branchSteps[index + 1])}
              onDeleted={() => onDeleted(step.id)}
            />
          </StyledBranchStep>
        ))}
        <StyledLaneConnector />
        {isPaletteOpen ? (
          <SequenceStepPalette
            allowConditions={false}
            isCreating={isAddingStep}
            onAdd={(option) => onAddStep(option, branch)}
            onClose={onClosePalette}
          />
        ) : (
          <Button
            title={
              outcome === SEQUENCE_CONDITION_BRANCHES.YES
                ? t`Add Yes step`
                : t`Add No step`
            }
            Icon={IconPlus}
            size="small"
            variant="secondary"
            disabled={!canAddOrReorder}
            onClick={() => onOpenPalette(branch)}
          />
        )}
        <StyledLaneToMergeConnector />
      </StyledLane>
    );
  };

  return (
    <StyledBranchFlow>
      <StyledBranches>
        <StyledSplitStem />
        <StyledSplitRail />
        <StyledMergeRail />
        {renderLane(SEQUENCE_CONDITION_BRANCHES.YES)}
        {renderLane(SEQUENCE_CONDITION_BRANCHES.NO)}
      </StyledBranches>
      <StyledMergeStem />
      <StyledMergeNode>
        <IconArrowMerge size={16} />
        {t`Paths merge`}
      </StyledMergeNode>
      <StyledMergeCaption>
        {t`Both outcomes continue to the next step`}
      </StyledMergeCaption>
    </StyledBranchFlow>
  );
};
