import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { type SequenceTaskType, type TaskPriority } from 'twenty-shared/types';

export type TaskQueueRecord = ObjectRecord & {
  title: string | null;
  bodyV2: {
    blocknote: string | null;
    markdown: string | null;
  } | null;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | null;
  dueAt: string | null;
  assigneeId: string | null;
  type: SequenceTaskType | null;
  priority: TaskPriority | null;
  sequenceEnrollmentId: string | null;
  sequenceStepId: string | null;
};
