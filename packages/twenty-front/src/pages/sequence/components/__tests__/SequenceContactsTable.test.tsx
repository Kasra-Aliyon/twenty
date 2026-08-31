import { render, screen, within } from '@testing-library/react';
import { SEQUENCE_ENROLLMENT_STATUSES } from 'twenty-shared/types';

import { SequenceContactsTable } from '~/pages/sequence/components/SequenceContactsTable';

const enrollmentRecords = [
  {
    id: 'staged-enrollment-id',
    status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    currentStepId: null,
    currentStepPosition: 2.5,
    waitingOn: null,
    nextActionAt: null,
    errorMessage: null,
    person: {
      id: 'staged-person-id',
      name: { firstName: 'Staged', lastName: 'Person' },
      emails: { primaryEmail: 'staged@example.com' },
    },
  },
  {
    id: 'active-enrollment-id',
    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    currentStepId: 'second-step-id',
    currentStepPosition: 2,
    waitingOn: null,
    nextActionAt: null,
    errorMessage: null,
    person: {
      id: 'active-person-id',
      name: { firstName: 'Active', lastName: 'Person' },
      emails: { primaryEmail: 'active@example.com' },
    },
  },
];

const stepRecords = [
  { id: 'first-step-id', position: 1, settings: {} },
  { id: 'second-step-id', position: 2, settings: {} },
  {
    id: 'branch-step-id',
    position: 2.75,
    settings: {
      branch: { conditionStepId: 'second-step-id', outcome: 'YES' },
    },
  },
  { id: 'starting-step-id', position: 3, settings: {} },
];

const mockUseFindManyRecords = jest.fn(
  ({ objectNameSingular }: { objectNameSingular: string }) => ({
    records:
      objectNameSingular === 'sequenceEnrollment'
        ? enrollmentRecords
        : stepRecords,
    refetch: jest.fn(),
    fetchMoreRecords: jest.fn(),
    hasNextPage: false,
    loading: false,
  }),
);

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: (options: { objectNameSingular: string }) =>
    mockUseFindManyRecords(options),
}));

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: jest.fn() }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));

jest.mock('@/ui/layout/dropdown/components/Dropdown', () => ({
  Dropdown: () => null,
}));

jest.mock('@/ui/layout/dropdown/hooks/useCloseDropdown', () => ({
  useCloseDropdown: () => ({ closeDropdown: jest.fn() }),
}));

describe('SequenceContactsTable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the starting step for a pending staged enrollment', () => {
    render(
      <SequenceContactsTable
        sequenceId="sequence-id"
        canUpdate
        onEnrollmentUpdated={jest.fn()}
      />,
    );

    const stagedEnrollmentRow = screen.getByText('Staged Person').closest('tr');
    const activeEnrollmentRow = screen.getByText('Active Person').closest('tr');

    expect(stagedEnrollmentRow).not.toBeNull();
    expect(activeEnrollmentRow).not.toBeNull();
    expect(
      within(stagedEnrollmentRow as HTMLTableRowElement).getByText(
        'Starts at step 4',
      ),
    ).toBeInTheDocument();
    expect(
      within(activeEnrollmentRow as HTMLTableRowElement).getByText('2'),
    ).toBeInTheDocument();

    expect(mockUseFindManyRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'sequenceEnrollment',
        recordGqlFields: expect.objectContaining({
          currentStepPosition: true,
        }),
      }),
    );
    expect(mockUseFindManyRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'sequenceStep',
        recordGqlFields: expect.objectContaining({ settings: true }),
      }),
    );
  });
});
