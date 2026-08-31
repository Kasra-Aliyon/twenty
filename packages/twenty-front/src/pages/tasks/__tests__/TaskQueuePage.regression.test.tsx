import { fireEvent, render, screen } from '@testing-library/react';
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

jest.mock('@/auth/states/currentWorkspaceMemberState', () => ({
  currentWorkspaceMemberState: {},
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({ objectMetadataItem: { id: 'task' } }),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: (options: unknown) => mockUseFindManyRecords(options),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/ui/layout/page/components/PageCardHeader', () => ({
  PageCardHeader: ({ title }: { title: ReactNode }) => <header>{title}</header>,
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
});
