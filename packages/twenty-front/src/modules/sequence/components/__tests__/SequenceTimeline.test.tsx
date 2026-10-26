import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ButtonProps } from 'twenty-ui/input';

import { SequenceTimeline } from '@/sequence/components/SequenceTimeline';
import { SEQUENCE_ACTIVITY_FILTER } from '@/sequence/utils/sequenceActivity';

const mockFindTimeline = jest.fn();
const mockFetchMore = jest.fn();
const mockRefetch = jest.fn();
const mockTimelineForm = jest.fn();

jest.mock(
  '@/activities/timeline-activities/hooks/useTimelineActivities',
  () => ({
    useTimelineActivities: (...args: unknown[]) => mockFindTimeline(...args),
  }),
);
jest.mock('@/sequence/components/SequenceActivityForm', () => ({
  SequenceActivityForm: (props: unknown) => {
    mockTimelineForm(props);
    return <div>Activity form</div>;
  },
}));
jest.mock('@/activities/timeline-activities/components/EventList', () => ({
  EventList: ({ events }: { events: Array<{ id: string; name: string }> }) => (
    <div>
      {events.map((event) => (
        <div key={event.id}>{event.name}</div>
      ))}
    </div>
  ),
}));
jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: jest.fn() }),
}));
jest.mock('twenty-ui/input', () => ({
  Button: ({ title, disabled, onClick }: ButtonProps) => (
    <button disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
}));

const renderTimeline = () =>
  render(
    <SequenceTimeline
      personId="person"
      taskId="task"
      sequenceEnrollmentId="enrollment"
      isCallTask={true}
      canRecord={true}
    />,
  );

describe('SequenceTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindTimeline.mockReturnValue({
      timelineActivities: [
        { id: 'event', name: 'linkedin.connection-established' },
      ],
      firstQueryLoading: false,
      loadingMore: false,
      hasNextPage: true,
      fetchMoreRecords: mockFetchMore,
      refetch: mockRefetch,
    });
    mockRefetch.mockResolvedValue(undefined);
    mockFetchMore.mockResolvedValue(undefined);
  });

  it('should show the form above persisted history, scoped to the prospect', () => {
    renderTimeline();
    expect(mockFindTimeline).toHaveBeenCalledWith(
      { id: 'person', targetObjectNameSingular: 'person' },
      SEQUENCE_ACTIVITY_FILTER,
    );
    expect(mockTimelineForm).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'person',
        taskId: 'task',
        sequenceEnrollmentId: 'enrollment',
        onSaved: mockRefetch,
      }),
    );
    expect(
      screen
        .getByText('Activity form')
        .compareDocumentPosition(
          screen.getByText('linkedin.connection-established'),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('should let the user paginate older activity and refresh after reopening', async () => {
    const user = userEvent.setup();
    renderTimeline();
    await user.click(
      screen.getByRole('button', { name: 'Load older activity' }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh history' }));
    expect(mockFetchMore).toHaveBeenCalledTimes(1);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('should distinguish a failed history query from an empty timeline', () => {
    mockFindTimeline.mockReturnValue({
      timelineActivities: [],
      error: new Error('Unavailable'),
    });
    renderTimeline();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Activity history could not be loaded',
    );
    expect(
      screen.queryByText(/No outreach activity recorded yet/),
    ).not.toBeInTheDocument();
  });
});
