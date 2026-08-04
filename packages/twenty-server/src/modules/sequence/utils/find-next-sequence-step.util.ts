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

// Positions are not guaranteed unique: editing a sequence can leave two steps
// on the same position. Ordering on position alone made the tied step
// unreachable, because traversal only ever looked for a strictly greater
// position. Creation order breaks ties so every step is still visited exactly
// once, in a stable order.
const compareSteps = (
  first: SequenceStepWorkspaceEntity,
  second: SequenceStepWorkspaceEntity,
): number => {
  if (first.position !== second.position) {
    return first.position - second.position;
  }

  // createdAt is an ISO 8601 string, so lexicographic order is chronological.
  const createdAtComparison = (first.createdAt ?? '').localeCompare(
    second.createdAt ?? '',
  );

  return createdAtComparison !== 0
    ? createdAtComparison
    : first.id.localeCompare(second.id);
};

const findFirstStepInBranch = ({
  steps,
  branch,
}: {
  steps: SequenceStepWorkspaceEntity[];
  branch: SequenceStepBranch | undefined;
}) =>
  steps
    .filter((step) => isSameBranch(step.settings.branch, branch))
    .sort(compareSteps)[0];

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
        compareSteps(step, currentStep) > 0 &&
        isSameBranch(step.settings.branch, currentStep.settings.branch),
    )
    .sort(compareSteps)[0];

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
      .sort(compareSteps)[0];
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
