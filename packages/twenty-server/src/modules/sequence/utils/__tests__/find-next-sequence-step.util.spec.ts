import {
  SEQUENCE_CONDITION_BRANCHES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
} from 'twenty-shared/types';

import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { findNextSequenceStep } from 'src/modules/sequence/utils/find-next-sequence-step.util';

const conditionStep = {
  id: 'condition',
  position: 0,
  settings: {
    type: SEQUENCE_STEP_TYPES.CONDITION,
    condition: SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS,
  },
} as SequenceStepWorkspaceEntity;

const yesStep = {
  id: 'yes-step',
  position: 1,
  settings: {
    type: SEQUENCE_STEP_TYPES.CREATE_TASK,
    branch: {
      conditionStepId: conditionStep.id,
      outcome: SEQUENCE_CONDITION_BRANCHES.YES,
    },
    taskType: SEQUENCE_TASK_TYPES.CUSTOM,
    titleTemplate: 'Yes task',
    notesTemplate: '',
    priority: TASK_PRIORITIES.MEDIUM,
    assigneeWorkspaceMemberId: null,
    continueMode: 'ON_DONE',
    deadlineDays: null,
  },
} as SequenceStepWorkspaceEntity;

const noStep = {
  ...yesStep,
  id: 'no-step',
  position: 2,
  settings: {
    ...yesStep.settings,
    branch: {
      conditionStepId: conditionStep.id,
      outcome: SEQUENCE_CONDITION_BRANCHES.NO,
    },
    titleTemplate: 'No task',
  },
} as SequenceStepWorkspaceEntity;

const mergedStep = {
  ...yesStep,
  id: 'merged-step',
  position: 3,
  settings: {
    ...yesStep.settings,
    branch: undefined,
    titleTemplate: 'Merged task',
  },
} as SequenceStepWorkspaceEntity;

const steps = [conditionStep, yesStep, noStep, mergedStep];

describe('findNextSequenceStep', () => {
  it('starts with the first root step', () => {
    expect(
      findNextSequenceStep({
        steps,
        currentStepId: null,
        currentStepPosition: -1,
      }),
    ).toBe(conditionStep);
  });

  it('enters the evaluated condition branch', () => {
    expect(
      findNextSequenceStep({
        steps,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        conditionOutcome: SEQUENCE_CONDITION_BRANCHES.YES,
      }),
    ).toBe(yesStep);
    expect(
      findNextSequenceStep({
        steps,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        conditionOutcome: SEQUENCE_CONDITION_BRANCHES.NO,
      }),
    ).toBe(noStep);
  });

  it('waits for a condition outcome before choosing a branch', () => {
    expect(
      findNextSequenceStep({
        steps,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
      }),
    ).toBeUndefined();
  });

  it('merges after the selected branch finishes', () => {
    expect(
      findNextSequenceStep({
        steps,
        currentStepId: yesStep.id,
        currentStepPosition: yesStep.position,
      }),
    ).toBe(mergedStep);
  });

  it('continues through siblings in the same branch before merging', () => {
    const secondYesStep = {
      ...yesStep,
      id: 'second-yes-step',
      position: 2,
    } as SequenceStepWorkspaceEntity;
    const stepsWithTwoYesSteps = [
      conditionStep,
      yesStep,
      secondYesStep,
      { ...noStep, position: 3 },
      { ...mergedStep, position: 4 },
    ] as SequenceStepWorkspaceEntity[];

    expect(
      findNextSequenceStep({
        steps: stepsWithTwoYesSteps,
        currentStepId: yesStep.id,
        currentStepPosition: yesStep.position,
      }),
    ).toBe(secondYesStep);
  });

  it('skips an empty branch and rejoins the main flow', () => {
    expect(
      findNextSequenceStep({
        steps: [conditionStep, mergedStep],
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        conditionOutcome: SEQUENCE_CONDITION_BRANCHES.NO,
      }),
    ).toBe(mergedStep);
  });
});
