import { useCallback } from 'react';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useUpsertRecordsInStore } from '@/object-record/record-store/hooks/useUpsertRecordsInStore';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { type SequenceTimelineTarget } from '@/sequence/states/sequenceTimelineTargetComponentState';
import { type TaskQueueRecord } from '~/pages/tasks/types/TaskQueueRecord';

type TimelinePerson = ObjectRecord &
  NonNullable<TaskQueueRecord['taskTargets'][number]['targetPerson']>;

export const useSequenceTimelineTargetData = (
  target: SequenceTimelineTarget,
) => {
  const {
    record: task,
    loading: loadingTask,
    error: taskError,
    refetch: refetchTask,
  } = useFindOneRecord<TaskQueueRecord>({
    objectNameSingular: CoreObjectNameSingular.Task,
    objectRecordId: target.taskId,
    skip: !target.taskId,
    recordGqlFields: {
      id: true,
      title: true,
      type: true,
      status: true,
      sequenceEnrollmentId: true,
      bodyV2: { markdown: true },
      taskTargets: { id: true, targetPerson: { id: true } },
    },
  });
  const {
    record: enrollment,
    loading: loadingEnrollment,
    error: enrollmentError,
  } = useFindOneRecord<ObjectRecord & { personId: string }>({
    objectNameSingular: 'sequenceEnrollment',
    objectRecordId: task?.sequenceEnrollmentId ?? undefined,
    skip: !task?.sequenceEnrollmentId,
    recordGqlFields: { id: true, personId: true },
  });

  const targetPersonIds = [
    ...new Set(
      task?.taskTargets
        ?.map(({ targetPerson }) => targetPerson?.id)
        .filter(isDefined),
    ),
  ];
  // The enrollment is authoritative when a sequence task has stale targets.
  const personId = target.taskId
    ? task?.sequenceEnrollmentId
      ? enrollment?.personId
      : targetPersonIds.length === 1
        ? targetPersonIds[0]
        : undefined
    : target.personId;
  const { upsertRecordsInStore } = useUpsertRecordsInStore();
  const handlePeopleLoaded = useCallback(
    (people: TimelinePerson[]) => {
      upsertRecordsInStore({ partialRecords: people });
    },
    [upsertRecordsInStore],
  );
  const {
    records: people,
    loading: loadingPerson,
    error: personError,
  } = useFindManyRecords<TimelinePerson>({
    objectNameSingular: CoreObjectNameSingular.Person,
    filter: { id: { eq: personId } },
    skip: !personId,
    limit: 1,
    onCompleted: handlePeopleLoaded,
    recordGqlFields: {
      id: true,
      name: { firstName: true, lastName: true },
      phones: {
        primaryPhoneNumber: true,
        primaryPhoneCallingCode: true,
        additionalPhones: true,
      },
    },
  });
  const { objectMetadataItem: taskMetadata } = useObjectMetadataItem({
    objectNameSingular: CoreObjectNameSingular.Task,
  });
  const taskPermissions = useObjectPermissionsForObject(taskMetadata.id);
  const { objectMetadataItem: personMetadata } = useObjectMetadataItem({
    objectNameSingular: CoreObjectNameSingular.Person,
  });
  const personPermissions = useObjectPermissionsForObject(personMetadata.id);

  return {
    task,
    personId,
    person: people.find(({ id }) => id === personId),
    loading: loadingTask || loadingEnrollment || loadingPerson,
    error: taskError || enrollmentError || personError,
    refetchTask,
    canUpdateTask: taskPermissions.canUpdateObjectRecords,
    canRecord: task
      ? taskPermissions.canUpdateObjectRecords
      : personPermissions.canUpdateObjectRecords,
  };
};
