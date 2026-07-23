import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
} from 'twenty-shared/types';

import { getDefaultSequenceStepSettings } from '~/pages/sequence/utils/get-default-sequence-step-settings';
import { getSequenceStepPresentation } from '~/pages/sequence/utils/get-sequence-step-presentation';
import { getSequenceStepStorageType } from '~/pages/sequence/utils/get-sequence-step-storage-type';

describe('getDefaultSequenceStepSettings', () => {
  it('creates automated outreach actions by default', () => {
    expect(
      getDefaultSequenceStepSettings(SEQUENCE_STEP_TYPES.SEND_EMAIL),
    ).toEqual(
      expect.objectContaining({
        type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
        manualTaskTitle: '',
      }),
    );
  });

  it('creates separate call and manual-task presets', () => {
    expect(
      getDefaultSequenceStepSettings(SEQUENCE_STEP_TYPES.CREATE_TASK, {
        taskType: SEQUENCE_TASK_TYPES.CALL,
      }),
    ).toEqual(
      expect.objectContaining({
        taskType: SEQUENCE_TASK_TYPES.CALL,
        titleTemplate: 'Call {{ fullName }}',
      }),
    );
    expect(
      getDefaultSequenceStepSettings(SEQUENCE_STEP_TYPES.CREATE_TASK, {
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
      }),
    ).toEqual(
      expect.objectContaining({
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Follow up with {{ fullName }}',
      }),
    );
  });

  it('keeps the selected contact condition', () => {
    expect(
      getDefaultSequenceStepSettings(SEQUENCE_STEP_TYPES.CONDITION, {
        condition: SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER,
      }),
    ).toEqual({
      type: SEQUENCE_STEP_TYPES.CONDITION,
      condition: SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER,
    });
  });
});

describe('getSequenceStepStorageType', () => {
  it.each([
    SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
    SEQUENCE_STEP_TYPES.CONDITION,
    SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
  ])('stores %s with a legacy-compatible select value', (type) => {
    expect(getSequenceStepStorageType(type)).toBe(
      SEQUENCE_STEP_TYPES.CREATE_TASK,
    );
  });

  it('preserves step types supported by the original workspace metadata', () => {
    expect(getSequenceStepStorageType(SEQUENCE_STEP_TYPES.SEND_EMAIL)).toBe(
      SEQUENCE_STEP_TYPES.SEND_EMAIL,
    );
  });
});

describe('getSequenceStepPresentation', () => {
  it('uses settings to present a condition stored with a legacy type', () => {
    expect(
      getSequenceStepPresentation({
        name: null,
        settings: {
          type: SEQUENCE_STEP_TYPES.CONDITION,
          condition: SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        label: 'Has phone number',
        category: 'Condition',
      }),
    );
  });
});
