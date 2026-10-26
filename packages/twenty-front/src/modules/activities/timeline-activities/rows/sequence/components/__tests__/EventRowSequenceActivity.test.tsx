import { render, screen } from '@testing-library/react';

import { EventRowSequenceActivity } from '@/activities/timeline-activities/rows/sequence/components/EventRowSequenceActivity';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';

describe('EventRowSequenceActivity', () => {
  it('should render saved call results and notes without interpreting HTML', () => {
    const notes = '<script>alert("not markup")</script>';
    const { container } = render(
      <EventRowSequenceActivity
        authorFullName="You"
        createdAt="just now"
        labelIdentifierValue="Jane"
        mainObjectMetadataItem={{} as EnrichedObjectMetadataItem}
        linkedObjectMetadataItem={null}
        event={
          {
            name: 'sequence.call-recorded',
            properties: { source: 'manual', outcome: 'EMAIL_FOLLOW_UP', notes },
          } as TimelineActivity
        }
      />,
    );
    expect(
      screen.getByText('Call result: Email follow-up'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Manually recorded/)).toBeInTheDocument();
    expect(screen.getByText(notes)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it.each([
    ['LINKEDIN_FOLLOWED', 'LinkedIn followed'],
    ['LINKEDIN_COMMENTED', 'LinkedIn commented'],
  ])(
    'should display saved %s events after reopening the timeline',
    (activity, label) => {
      render(
        <EventRowSequenceActivity
          authorFullName="You"
          createdAt="yesterday"
          labelIdentifierValue="Jane"
          mainObjectMetadataItem={{} as EnrichedObjectMetadataItem}
          linkedObjectMetadataItem={null}
          event={
            {
              name: 'sequence.activity-recorded',
              properties: JSON.stringify({
                source: 'manual',
                activity,
                notes: 'Recorded context',
              }),
            } as TimelineActivity
          }
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText('Recorded context')).toBeInTheDocument();
    },
  );
});
