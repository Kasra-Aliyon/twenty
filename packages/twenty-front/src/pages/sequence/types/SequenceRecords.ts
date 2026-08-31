import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import {
  type SequenceEnrollmentStatus,
  type SequenceSettings,
  type SequenceStatus,
  type SequenceStepSettings,
  type SequenceStepType,
  type SequenceWaitingOn,
} from 'twenty-shared/types';

export type SequenceRecord = ObjectRecord & {
  deletedAt: string | null;
  name: string;
  status: SequenceStatus;
  senderConnectedAccountId: string | null;
  settings: SequenceSettings;
  enrolledCount: number;
  activeCount: number;
  completedCount: number;
  repliedCount: number;
  failedCount: number;
};

export type SequenceStepRecord = ObjectRecord & {
  sequenceId: string;
  name: string | null;
  type: SequenceStepType;
  position: number;
  settings: SequenceStepSettings;
};

export type SequenceEnrollmentRecord = ObjectRecord & {
  status: SequenceEnrollmentStatus;
  currentStepId: string | null;
  currentStepPosition: number;
  waitingOn: SequenceWaitingOn | null;
  nextActionAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
  person: {
    id: string;
    name: {
      firstName: string;
      lastName: string;
    };
    emails: {
      primaryEmail: string;
    };
  } | null;
};
