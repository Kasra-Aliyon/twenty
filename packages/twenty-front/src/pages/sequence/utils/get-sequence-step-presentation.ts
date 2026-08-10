import { t } from '@lingui/core/macro';
import {
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  type SequenceConditionType,
} from 'twenty-shared/types';
import {
  type IconComponent,
  IconBrandLinkedin,
  IconClock,
  IconFilter,
  IconListCheck,
  IconMail,
  IconMessage,
  IconPhone,
  IconSparkles,
  IconUserMinus,
} from 'twenty-ui/icon';

import { type SequenceStepRecord } from '../types/SequenceRecords';

export type SequenceStepPresentation = {
  label: string;
  category: 'Email' | 'LinkedIn' | 'Manual' | 'Tool' | 'Condition';
  Icon: IconComponent;
};

export const getSequenceConditionLabel = (
  condition: SequenceConditionType,
): string => {
  switch (condition) {
    case SEQUENCE_CONDITION_TYPES.IS_IN_LINKEDIN_NETWORK:
      return t`Is in LinkedIn network (1st)`;
    case SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS:
      return t`Has email address`;
    case SEQUENCE_CONDITION_TYPES.HAS_LINKEDIN_URL:
      return t`Has valid LinkedIn profile URL`;
    case SEQUENCE_CONDITION_TYPES.ACCEPTED_LINKEDIN_INVITE:
      return t`Accepted LinkedIn invite`;
    case SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE:
      return t`Received LinkedIn reply`;
    case SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER:
      return t`Has phone number`;
  }
};

export const getSequenceStepPresentation = (
  step: Pick<SequenceStepRecord, 'name' | 'settings'>,
): SequenceStepPresentation => {
  if (step.name) {
    return {
      label: step.name,
      category: 'Tool',
      Icon: IconListCheck,
    };
  }

  switch (step.settings.type) {
    case SEQUENCE_STEP_TYPES.SEND_EMAIL:
      return { label: t`Email`, category: 'Email', Icon: IconMail };
    case SEQUENCE_STEP_TYPES.DELAY:
      return { label: t`Wait / Delay`, category: 'Tool', Icon: IconClock };
    case SEQUENCE_STEP_TYPES.CREATE_TASK:
      return step.settings.taskType === SEQUENCE_TASK_TYPES.CALL
        ? { label: t`Call`, category: 'Manual', Icon: IconPhone }
        : {
            label: t`Manual task`,
            category: 'Manual',
            Icon: IconListCheck,
          };
    case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
      return {
        label: t`LinkedIn connection request`,
        category: 'LinkedIn',
        Icon: IconBrandLinkedin,
      };
    case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
      return {
        label: t`LinkedIn message`,
        category: 'LinkedIn',
        Icon: IconMessage,
      };
    case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
      return {
        label: t`Withdraw LinkedIn connection`,
        category: 'LinkedIn',
        Icon: IconUserMinus,
      };
    case SEQUENCE_STEP_TYPES.CONDITION:
      return {
        label: getSequenceConditionLabel(step.settings.condition),
        category: 'Condition',
        Icon: IconFilter,
      };
    case SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER:
      return {
        label: t`Enrich phone number`,
        category: 'Tool',
        Icon: IconSparkles,
      };
  }
};
