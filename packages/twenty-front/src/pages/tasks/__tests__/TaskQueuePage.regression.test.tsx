import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SEQUENCE_TASK_TYPES } from 'twenty-shared/types';

import { TaskQueuePage } from '~/pages/tasks/TaskQueuePage';

const mockUseFindManyRecords = jest.fn((_options: unknown) => ({
  records: [],
  refetch: jest.fn(),
  fetchMoreRecords: jest.fn(),
  hasNextPage: false,
  loading: false,
}));
const mockFetchAllCallTasks = jest.fn(async (): Promise<unknown[]> => []);
const mockUseLazyFetchAllRecords = jest.fn((_options: unknown) => ({
  fetchAllRecords: mockFetchAllCallTasks,
}));
const mockDownloadSequenceCallsCsv = jest.fn();

jest.mock('@/auth/states/currentWorkspaceMemberState', () => ({
  currentWorkspaceMemberState: {},
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({ objectMetadataItem: { id: 'task' } }),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: (options: unknown) => mockUseFindManyRecords(options),
}));

jest.mock('@/object-record/hooks/useLazyFetchAllRecords', () => ({
  useLazyFetchAllRecords: (options: unknown) =>
    mockUseLazyFetchAllRecords(options),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/settings/roles/hooks/useHasPermissionFlag', () => ({
  useHasPermissionFlag: () => true,
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));

jest.mock('@/ui/layout/page/components/PageCardHeader', () => ({
  PageCardHeader: ({
    title,
    actionButton,
  }: {
    title: ReactNode;
    actionButton?: ReactNode;
  }) => (
    <header>
      {title}
      {actionButton}
    </header>
  ),
}));

jest.mock('@/ui/layout/page/components/PageCardLayout', () => ({
  PageCardLayout: ({
    header,
    secondaryBar,
    children,
  }: {
    header: ReactNode;
    secondaryBar?: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {header}
      {secondaryBar}
      {children}
    </>
  ),
}));

jest.mock('@/ui/layout/page/components/PageContainer', () => ({
  PageContainer: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => ({ id: 'workspace-member-id' }),
}));

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

jest.mock('../components/TaskQueueFilters', () => ({
  TASK_CATEGORY_FILTERS: {
    ALL: 'ALL',
    LINKEDIN: 'LINKEDIN',
    CALL: 'CALL',
    EMAIL: 'EMAIL',
    TODO: 'TODO',
    CUSTOM: 'CUSTOM',
  },
  TaskQueueFilters: ({
    onCategoryFilterChange,
  }: {
    onCategoryFilterChange: (value: 'LINKEDIN') => void;
  }) => (
    <button onClick={() => onCategoryFilterChange('LINKEDIN')}>
      Filter LinkedIn
    </button>
  ),
}));

jest.mock('../components/TaskQueueList', () => ({
  TaskQueueList: () => null,
}));

jest.mock('../utils/generate-sequence-calls-csv', () => ({
  downloadSequenceCallsCsv: (tasks: unknown[]) =>
    mockDownloadSequenceCallsCsv(tasks),
}));

describe('TaskQueuePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries open sequence tasks across assignees', () => {
    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <TaskQueuePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Sequence tasks')).toBeInTheDocument();

    const queryOptions = mockUseFindManyRecords.mock.calls[0][0] as {
      filter: { and: unknown[] };
      skip?: boolean;
    };

    expect(queryOptions.filter.and).toEqual(
      expect.arrayContaining([
        { status: { in: ['TODO', 'IN_PROGRESS'] } },
        { sequenceEnrollmentId: { is: 'NOT_NULL' } },
      ]),
    );
    expect(queryOptions.filter.and).not.toEqual(
      expect.arrayContaining([{ assigneeId: expect.anything() }]),
    );
    expect(queryOptions.skip).toBeUndefined();
  });

  it('filters both LinkedIn task types with the LinkedIn category', () => {
    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <TaskQueuePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter LinkedIn' }));

    const latestQueryOptions = mockUseFindManyRecords.mock.calls[
      mockUseFindManyRecords.mock.calls.length - 1
    ][0] as {
      filter: { and: unknown[] };
    };

    expect(latestQueryOptions.filter.and).toEqual(
      expect.arrayContaining([
        {
          type: {
            in: [
              SEQUENCE_TASK_TYPES.LINKEDIN_CONNECTION,
              SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE,
            ],
          },
        },
      ]),
    );
  });

  it('exports all open call task contacts', async () => {
    const callTaskNodes = [
      {
        id: 'call-task-id',
        taskTargets: {
          edges: [
            {
              node: {
                id: 'task-target-id',
                targetPerson: {
                  id: 'person-id',
                  name: { firstName: 'Jane', lastName: 'Doe' },
                },
              },
            },
          ],
        },
      },
    ];
    mockFetchAllCallTasks.mockResolvedValueOnce(callTaskNodes);

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <TaskQueuePage />
      </MemoryRouter>,
    );

    const exportQueryOptions = mockUseLazyFetchAllRecords.mock.calls[0][0] as {
      filter: { and: unknown[] };
      recordGqlFields: Record<string, unknown>;
    };

    expect(exportQueryOptions.filter.and).toEqual(
      expect.arrayContaining([
        { status: { in: ['TODO', 'IN_PROGRESS'] } },
        { sequenceEnrollmentId: { is: 'NOT_NULL' } },
        { type: { in: [SEQUENCE_TASK_TYPES.CALL] } },
      ]),
    );
    expect(exportQueryOptions.recordGqlFields).toMatchObject({
      taskTargets: {
        targetPerson: {
          name: { firstName: true, lastName: true },
          phones: {
            primaryPhoneNumber: true,
            primaryPhoneCallingCode: true,
            additionalPhones: true,
          },
          emails: { primaryEmail: true },
          jobTitle: true,
          company: { name: true },
          address: { addressCountry: true },
          linkedinLink: { primaryLinkUrl: true },
        },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export calls' }));

    expect(mockFetchAllCallTasks).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockDownloadSequenceCallsCsv).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'call-task-id',
          taskTargets: [
            expect.objectContaining({
              id: 'task-target-id',
              targetPerson: expect.objectContaining({
                id: 'person-id',
                name: { firstName: 'Jane', lastName: 'Doe' },
              }),
            }),
          ],
        }),
      ]);
    });
  });
});
