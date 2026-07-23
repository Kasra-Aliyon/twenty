import {
  SEQUENCE_STEP_TYPES,
  type SequenceConditionBranch,
  type SequenceStepBranch,
} from 'twenty-shared/types';

import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';

const isSameBranch = (
  firstBranch: SequenceStepBranch | undefined,
  secondBranch: SequenceStepBranch | undefined,
) =>
  firstBranch?.conditionStepId === secondBranch?.conditionStepId &&
  firstBranch?.outcome === secondBranch?.outcome;

const findFirstStepInBranch = ({
  steps,
  branch,
}: {
  steps: SequenceStepWorkspaceEntity[];
  branch: SequenceStepBranch | undefined;
}) =>
  steps
    .filter((step) => isSameBranch(step.settings.branch, branch))
    .sort((first, second) => first.position - second.position)[0];

const findNextSiblingOrMerge = ({
  steps,
  currentStep,
}: {
  steps: SequenceStepWorkspaceEntity[];
  currentStep: SequenceStepWorkspaceEntity;
}): SequenceStepWorkspaceEntity | undefined => {
  const nextSibling = steps
    .filter(
      (step) =>
        step.position > currentStep.position &&
        isSameBranch(step.settings.branch, currentStep.settings.branch),
    )
    .sort((first, second) => first.position - second.position)[0];

  if (nextSibling) {
    return nextSibling;
  }

  const currentBranch = currentStep.settings.branch;

  if (!currentBranch) {
    return undefined;
  }

  const parentCondition = steps.find(
    ({ id }) => id === currentBranch.conditionStepId,
  );

  return parentCondition
    ? findNextSiblingOrMerge({ steps, currentStep: parentCondition })
    : undefined;
};

export const findNextSequenceStep = ({
  steps,
  currentStepId,
  currentStepPosition,
  conditionOutcome,
}: {
  steps: SequenceStepWorkspaceEntity[];
  currentStepId: string | null;
  currentStepPosition: number;
  conditionOutcome?: SequenceConditionBranch;
}): SequenceStepWorkspaceEntity | undefined => {
  const currentStep = steps.find(({ id }) => id === currentStepId);

  if (!currentStep) {
    return steps
      .filter(
        (step) => !step.settings.branch && step.position > currentStepPosition,
      )
      .sort((first, second) => first.position - second.position)[0];
  }

  if (currentStep.settings.type === SEQUENCE_STEP_TYPES.CONDITION) {
    if (!conditionOutcome) {
      return undefined;
    }

    const firstBranchStep = findFirstStepInBranch({
      steps,
      branch: {
        conditionStepId: currentStep.id,
        outcome: conditionOutcome,
      },
    });

    return (
      firstBranchStep ??
      findNextSiblingOrMerge({
        steps,
        currentStep,
      })
    );
  }

  return findNextSiblingOrMerge({
    steps,
    currentStep,
  });
};
