import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  AppPath,
  CoreObjectNameSingular,
  FeatureFlagKey,
} from 'twenty-shared/types';
import { IconListCheck } from 'twenty-ui/icon';

import {
  TaskQueueFilters,
  type TaskPriorityFilter,
  type TaskTypeFilter,
} from './components/TaskQueueFilters';
import { TaskQueueList } from './components/TaskQueueList';
import { type TaskQueueRecord } from './types/TaskQueueRecord';

const TASK_QUEUE_REFRESH_INTERVAL_MILLISECONDS = 15_000;

const TaskQueuePageContent = () => {
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>('ALL');
  const [priorityFilter, setPriorityFilter] =
    useState<TaskPriorityFilter>('ALL');
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const { objectMetadataItem: taskObjectMetadataItem } = useObjectMetadataItem({
    objectNameSingular: CoreObjectNameSingular.Task,
  });
  const taskPermissions = useObjectPermissionsForObject(
    taskObjectMetadataItem.id,
  );
  const { records: tasks, refetch } = useFindManyRecords<TaskQueueRecord>({
    objectNameSingular: CoreObjectNameSingular.Task,
    filter: {
      and: [
        { status: { in: ['TODO', 'IN_PROGRESS'] } },
        { assigneeId: { eq: currentWorkspaceMember?.id ?? '' } },
      ],
    },
    orderBy: [{ dueAt: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      createdAt: true,
      title: true,
      bodyV2: true,
      status: true,
      dueAt: true,
      assigneeId: true,
      type: true,
      priority: true,
      sequenceEnrollmentId: true,
      sequenceStepId: true,
    },
    limit: QUERY_MAX_RECORDS,
    skip: !currentWorkspaceMember?.id,
  });

  useEffect(() => {
    if (!currentWorkspaceMember?.id) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refetch().catch(() => undefined);
    }, TASK_QUEUE_REFRESH_INTERVAL_MILLISECONDS);

    return () => window.clearInterval(intervalId);
  }, [currentWorkspaceMember?.id, refetch]);

  const filteredTasks = tasks.filter(
    (task) =>
      (typeFilter === 'ALL' || task.type === typeFilter) &&
      (priorityFilter === 'ALL' || task.priority === priorityFilter),
  );

  return (
    <PageContainer>
      <PageCardLayout
        header={
          <PageCardHeader
            icon={<IconListCheck size={18} />}
            title={t`My tasks`}
          />
        }
        secondaryBar={
          <TaskQueueFilters
            typeFilter={typeFilter}
            priorityFilter={priorityFilter}
            onTypeFilterChange={setTypeFilter}
            onPriorityFilterChange={setPriorityFilter}
          />
        }
      >
        <TaskQueueList
          tasks={filteredTasks}
          canUpdateTasks={taskPermissions.canUpdateObjectRecords}
          onTaskCompleted={async () => {
            await refetch();
          }}
        />
      </PageCardLayout>
    </PageContainer>
  );
};

export const TaskQueuePage = () => {
  const isOutreachSequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );

  if (!isOutreachSequencesEnabled) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  return <TaskQueuePageContent />;
};
