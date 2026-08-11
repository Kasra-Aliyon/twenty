import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
  type SequenceConditionType,
  type SequenceStepSettings,
  type SequenceStepType,
  type SequenceTaskType,
} from 'twenty-shared/types';

type DefaultSequenceStepSettingsOptions = {
  condition?: SequenceConditionType;
  taskType?: SequenceTaskType;
};

const AUTOMATED_EXECUTION_DEFAULTS = {
  executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
  manualTaskTitle: '',
  manualTaskDescription: '',
} as const;

export const getDefaultSequenceStepSettings = (
  type: SequenceStepType,
  options: DefaultSequenceStepSettingsOptions = {},
): SequenceStepSettings => {
  switch (type) {
    case SEQUENCE_STEP_TYPES.SEND_EMAIL:
      return {
        type,
        ...AUTOMATED_EXECUTION_DEFAULTS,
        subject: '',
        bodyHtml: '',
        threadAsReplyToPreviousEmail: false,
        stopOnReply: null,
      };
    case SEQUENCE_STEP_TYPES.DELAY:
      return { type, days: 1, hours: 0, minutes: 0 };
    case SEQUENCE_STEP_TYPES.CREATE_TASK:
      return {
        type,
        taskType: options.taskType ?? SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate:
          options.taskType === SEQUENCE_TASK_TYPES.CALL
            ? 'Call {{ fullName }}'
            : 'Follow up with {{ fullName }}',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      };
    case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
      return {
        type,
        ...AUTOMATED_EXECUTION_DEFAULTS,
        noteTemplate: '',
      };
    case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
      return {
        type,
        ...AUTOMATED_EXECUTION_DEFAULTS,
        messageTemplate: '',
      };
    case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
      return {
        type,
        ...AUTOMATED_EXECUTION_DEFAULTS,
        withdrawAfterDays: 7,
        withdrawAfterHours: 0,
      };
    case SEQUENCE_STEP_TYPES.CONDITION:
      return {
        type,
        condition:
          options.condition ?? SEQUENCE_CONDITION_TYPES.IS_IN_LINKEDIN_NETWORK,
      };
    case SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER:
      return {
        type,
        ...AUTOMATED_EXECUTION_DEFAULTS,
      };
  }
};
