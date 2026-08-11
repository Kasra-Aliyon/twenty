import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { type SequenceTaskType, type TaskPriority } from 'twenty-shared/types';

export type TaskQueueRecord = ObjectRecord & {
  title: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | null;
  dueAt: string | null;
  type: SequenceTaskType | null;
  priority: TaskPriority | null;
  sequenceEnrollmentId: string | null;
  taskTargets: Array<{
    id: string;
    targetPerson: {
      id: string;
      linkedinLink: {
        primaryLinkUrl: string | null;
      } | null;
    } | null;
  }>;
};
