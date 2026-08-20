import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SEQUENCE_STATUSES } from 'twenty-shared/types';

import { SequencePage } from '~/pages/sequence/SequencePage';
import { SequencesPage } from '~/pages/sequence/SequencesPage';
import { getSequenceStatusErrorMessage } from '~/pages/sequence/utils/get-sequence-status-error-message';

const mockUpdateOneRecord = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();
const mockRefetch = jest.fn();

const mockCreateSequenceRecord = () => ({
  id: 'sequence-id',
  deletedAt: null,
  name: 'Outbound sequence',
  status: SEQUENCE_STATUSES.PAUSED,
  senderConnectedAccountId: null,
  settings: {},
  enrolledCount: 3,
  activeCount: 1,
  completedCount: 1,
  repliedCount: 1,
  failedCount: 0,
});

const createValidationError = (message: string) =>
  new CombinedGraphQLErrors({
    data: null,
    errors: [
      {
        message,
        extensions: { code: 'BAD_USER_INPUT' },
      },
    ],
  });

jest.mock('@/object-metadata/hooks/useDoObjectMetadataItemsExist', () => ({
  useDoObjectMetadataItemsExist: () => true,
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: ({
    objectNameSingular,
  }: {
    objectNameSingular: string;
  }) => ({ objectMetadataItem: { id: objectNameSingular } }),
}));

jest.mock('@/object-record/hooks/useFindOneRecord', () => ({
  useFindOneRecord: () => ({
    record: mockCreateSequenceRecord(),
    loading: false,
    refetch: mockRefetch,
  }),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: ({
    objectNameSingular,
  }: {
    objectNameSingular: string;
  }) =>
    objectNameSingular === 'sequenceEnrollment'
      ? {
          records: [],
          totalCount: 0,
          refetch: mockRefetch,
        }
      : {
          records: [mockCreateSequenceRecord()],
          refetch: mockRefetch,
          fetchMoreRecords: jest.fn(),
          hasNextPage: false,
          loading: false,
        },
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({
    canUpdateObjectRecords: true,
    canSoftDeleteObjectRecords: true,
    canDestroyObjectRecords: true,
  }),
}));

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock(
  '@/object-record/record-index/components/RecordIndexSkeletonLoader',
  () => ({ RecordIndexSkeletonLoader: () => <div>Loading</div> }),
);

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
  }),
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

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

jest.mock('../components/SequenceActionsMenu', () => ({
  SequenceActionsMenu: () => null,
}));

jest.mock('../components/SequenceAnalyticsSection', () => ({
  SequenceAnalyticsSection: () => null,
}));

jest.mock('../components/SequenceContactsTable', () => ({
  SequenceContactsTable: () => null,
}));

jest.mock('../components/SequenceSettingsSection', () => ({
  SequenceSettingsSection: () => null,
}));

jest.mock('../components/SequenceStepList', () => ({
  SequenceStepList: () => null,
}));

jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    onClick,
    disabled,
  }: {
    title: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {title}
    </button>
  ),
  Toggle: ({
    value,
    onChange,
    disabled,
  }: {
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label="Sequence status"
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={() => onChange(!value)}
    />
  ),
}));

describe('sequence status validation errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefetch.mockResolvedValue({});
  });

  it('shows the server validation reason on the sequence page', async () => {
    mockUpdateOneRecord.mockRejectedValue(
      createValidationError('Choose a sender before activating the sequence'),
    );

    render(
      <MemoryRouter
        initialEntries={['/sequences/sequence-id']}
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <Routes>
          <Route path="/sequences/:sequenceId" element={<SequencePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      expect(mockEnqueueErrorSnackBar).toHaveBeenCalledWith({
        message: 'Choose a sender before activating the sequence',
      });
    });
  });

  it('shows the server validation reason on the sequences list', async () => {
    mockUpdateOneRecord.mockRejectedValue(
      createValidationError('Add a step before activating the sequence'),
    );

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <SequencesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sequence status' }));

    await waitFor(() => {
      expect(mockEnqueueErrorSnackBar).toHaveBeenCalledWith({
        message: 'Add a step before activating the sequence',
      });
    });
  });

  it('does not expose non-validation error details', () => {
    expect(
      getSequenceStatusErrorMessage({
        error: new Error('database password leaked in a stack trace'),
        fallbackMessage: 'The sequence status could not be updated.',
      }),
    ).toBe('The sequence status could not be updated.');

    expect(
      getSequenceStatusErrorMessage({
        error: new CombinedGraphQLErrors({
          data: null,
          errors: [
            {
              message: 'Internal database detail',
              extensions: { code: 'INTERNAL_SERVER_ERROR' },
            },
          ],
        }),
        fallbackMessage: 'The sequence status could not be updated.',
      }),
    ).toBe('The sequence status could not be updated.');
  });
});
