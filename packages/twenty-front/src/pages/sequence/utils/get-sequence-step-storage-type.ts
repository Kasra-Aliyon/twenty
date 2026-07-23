import {
  SEQUENCE_STEP_TYPES,
  type SequenceStepType,
} from 'twenty-shared/types';

// Existing workspaces may not have the newest sequence step select options yet.
// The settings JSON remains the canonical step discriminator, while this value
// stays compatible with the original metadata options.
export const getSequenceStepStorageType = (
  type: SequenceStepType,
): SequenceStepType => {
  switch (type) {
    case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
    case SEQUENCE_STEP_TYPES.CONDITION:
    case SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER:
      return SEQUENCE_STEP_TYPES.CREATE_TASK;
    default:
      return type;
  }
};
