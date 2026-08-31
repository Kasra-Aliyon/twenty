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
      name?: {
        firstName: string | null;
        lastName: string | null;
      } | null;
      phones?: {
        primaryPhoneNumber: string | null;
        primaryPhoneCallingCode: string | null;
        additionalPhones:
          | Array<{
              number: string;
              callingCode: string;
            }>
          | string
          | null;
      } | null;
      emails?: {
        primaryEmail: string | null;
      } | null;
      jobTitle?: string | null;
      company?: {
        name: string | null;
      } | null;
      address?: {
        addressCountry: string | null;
      } | null;
      linkedinLink: {
        primaryLinkUrl: string | null;
      } | null;
    } | null;
  }>;
};
