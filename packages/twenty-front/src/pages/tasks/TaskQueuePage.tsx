import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AppPath,
  CoreObjectNameSingular,
  FeatureFlagKey,
  SEQUENCE_TASK_TYPES,
  type SequenceTaskType,
} from 'twenty-shared/types';
import { IconListCheck } from 'twenty-ui/icon';

import {
  TASK_CATEGORY_FILTERS,
  TaskQueueFilters,
  type TaskCategoryFilter,
  type TaskPriorityFilter,
} from './components/TaskQueueFilters';
import { TaskQueueList } from './components/TaskQueueList';
import { type TaskQueueRecord } from './types/TaskQueueRecord';

const TASK_QUEUE_REFRESH_INTERVAL_MILLISECONDS = 15_000;
const TASK_QUEUE_PAGE_SIZE = 50;
const TASK_TYPES_BY_CATEGORY: Record<
  Exclude<TaskCategoryFilter, typeof TASK_CATEGORY_FILTERS.ALL>,
  SequenceTaskType[]
> = {
  [TASK_CATEGORY_FILTERS.LINKEDIN]: [
    SEQUENCE_TASK_TYPES.LINKEDIN_CONNECTION,
    SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE,
  ],
  [TASK_CATEGORY_FILTERS.CALL]: [SEQUENCE_TASK_TYPES.CALL],
  [TASK_CATEGORY_FILTERS.EMAIL]: [SEQUENCE_TASK_TYPES.EMAIL],
  [TASK_CATEGORY_FILTERS.TODO]: [SEQUENCE_TASK_TYPES.TODO],
  [TASK_CATEGORY_FILTERS.CUSTOM]: [SEQUENCE_TASK_TYPES.CUSTOM],
};

const TaskQueuePageContent = () => {
  const [categoryFilter, setCategoryFilter] = useState<TaskCategoryFilter>(
    TASK_CATEGORY_FILTERS.ALL,
  );
  const [priorityFilter, setPriorityFilter] =
    useState<TaskPriorityFilter>('ALL');
  const { objectMetadataItem: taskObjectMetadataItem } = useObjectMetadataItem({
    objectNameSingular: CoreObjectNameSingular.Task,
  });
  const taskPermissions = useObjectPermissionsForObject(
    taskObjectMetadataItem.id,
  );
  const {
    records: tasks,
    refetch,
    fetchMoreRecords,
    hasNextPage,
    loading,
  } = useFindManyRecords<TaskQueueRecord>({
    objectNameSingular: CoreObjectNameSingular.Task,
    filter: {
      and: [
        { status: { in: ['TODO', 'IN_PROGRESS'] } },
        { sequenceEnrollmentId: { is: 'NOT_NULL' } },
        ...(categoryFilter === TASK_CATEGORY_FILTERS.ALL
          ? []
          : [{ type: { in: TASK_TYPES_BY_CATEGORY[categoryFilter] } }]),
        ...(priorityFilter === 'ALL'
          ? []
          : [{ priority: { eq: priorityFilter } }]),
      ],
    },
    orderBy: [{ dueAt: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      type: true,
      priority: true,
      sequenceEnrollmentId: true,
      taskTargets: {
        id: true,
        targetPerson: {
          id: true,
          linkedinLink: {
            primaryLinkUrl: true,
          },
        },
      },
    },
    limit: TASK_QUEUE_PAGE_SIZE,
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refetch().catch(() => undefined);
    }, TASK_QUEUE_REFRESH_INTERVAL_MILLISECONDS);

    return () => window.clearInterval(intervalId);
  }, [refetch]);

  return (
    <PageContainer>
      <PageCardLayout
        header={
          <PageCardHeader
            icon={<IconListCheck size={18} />}
            title={t`Sequence tasks`}
          />
        }
        secondaryBar={
          <TaskQueueFilters
            categoryFilter={categoryFilter}
            priorityFilter={priorityFilter}
            onCategoryFilterChange={setCategoryFilter}
            onPriorityFilterChange={setPriorityFilter}
          />
        }
      >
        <TaskQueueList
          tasks={tasks}
          hasNextPage={hasNextPage}
          isLoadingMore={loading && tasks.length > 0}
          onLoadMore={fetchMoreRecords}
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
