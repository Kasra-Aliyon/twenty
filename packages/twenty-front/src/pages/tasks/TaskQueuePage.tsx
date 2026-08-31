import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { getRecordFromRecordNode } from '@/object-record/cache/utils/getRecordFromRecordNode';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useLazyFetchAllRecords } from '@/object-record/hooks/useLazyFetchAllRecords';
import { EXPORT_TABLE_DATA_DEFAULT_PAGE_SIZE } from '@/object-record/object-options-dropdown/constants/ExportTableDataDefaultPageSize';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
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
import { PermissionFlagType } from '~/generated-metadata/graphql';
import { IconFileExport, IconListCheck } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';

import {
  TASK_CATEGORY_FILTERS,
  TaskQueueFilters,
  type TaskCategoryFilter,
  type TaskPriorityFilter,
} from './components/TaskQueueFilters';
import { TaskQueueList } from './components/TaskQueueList';
import { type TaskQueueRecord } from './types/TaskQueueRecord';
import { downloadSequenceCallsCsv } from './utils/generate-sequence-calls-csv';

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
  const [isExportingCalls, setIsExportingCalls] = useState(false);
  const hasExportCsvPermission = useHasPermissionFlag(
    PermissionFlagType.EXPORT_CSV,
  );
  const { enqueueErrorSnackBar } = useSnackBar();
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

  const { fetchAllRecords: fetchAllCallTasks } =
    useLazyFetchAllRecords<TaskQueueRecord>({
      objectNameSingular: CoreObjectNameSingular.Task,
      filter: {
        and: [
          { status: { in: ['TODO', 'IN_PROGRESS'] } },
          { sequenceEnrollmentId: { is: 'NOT_NULL' } },
          { type: { in: [SEQUENCE_TASK_TYPES.CALL] } },
        ],
      },
      orderBy: [{ dueAt: 'AscNullsLast' }],
      recordGqlFields: {
        id: true,
        taskTargets: {
          id: true,
          targetPerson: {
            id: true,
            name: {
              firstName: true,
              lastName: true,
            },
            phones: {
              primaryPhoneNumber: true,
              primaryPhoneCallingCode: true,
              additionalPhones: true,
            },
            emails: {
              primaryEmail: true,
            },
            jobTitle: true,
            company: {
              name: true,
            },
            address: {
              addressCountry: true,
            },
            linkedinLink: {
              primaryLinkUrl: true,
            },
          },
        },
      },
      limit: EXPORT_TABLE_DATA_DEFAULT_PAGE_SIZE,
    });

  const handleExportCalls = async () => {
    setIsExportingCalls(true);

    try {
      const callTaskNodes = await fetchAllCallTasks();
      const callTasks = callTaskNodes.map((callTaskNode) =>
        getRecordFromRecordNode<TaskQueueRecord>({
          recordNode: callTaskNode,
        }),
      );

      downloadSequenceCallsCsv(callTasks);
    } catch {
      enqueueErrorSnackBar({
        message: t`The call contacts could not be exported.`,
      });
    } finally {
      setIsExportingCalls(false);
    }
  };

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
            actionButton={
              hasExportCsvPermission ? (
                <Button
                  Icon={IconFileExport}
                  title={t`Export calls`}
                  ariaLabel={t`Export calls`}
                  size="small"
                  variant="secondary"
                  isLoading={isExportingCalls}
                  disabled={isExportingCalls}
                  onClick={() => void handleExportCalls()}
                />
              ) : null
            }
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
