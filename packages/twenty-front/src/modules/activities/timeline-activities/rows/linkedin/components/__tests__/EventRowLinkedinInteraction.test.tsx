import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';

import { EventRowLinkedinInteraction } from '@/activities/timeline-activities/rows/linkedin/components/EventRowLinkedinInteraction';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';

const buildEvent = (name: string) =>
  ({
    createdAt: '2026-08-13T09:00:00.000Z',
    happensAt: '2026-08-13T09:00:00.000Z',
    id: 'activity-id',
    name,
  }) as TimelineActivity;

describe('EventRowLinkedinInteraction', () => {
  it.each([
    ['linkedin.connection-request-sent', 'sent a LinkedIn connection request'],
    [
      'linkedin.connection-request-withdrawn',
      'withdrew the LinkedIn connection request',
    ],
    ['linkedin.connection-established', 'connected on LinkedIn'],
    ['linkedin.message-sent', 'sent a LinkedIn message'],
    ['linkedin.message-received', 'received a LinkedIn message'],
  ])('renders %s timeline interactions', (name, label) => {
    render(
      <I18nProvider i18n={i18n}>
        <EventRowLinkedinInteraction
          authorFullName="You"
          createdAt="just now"
          event={buildEvent(name)}
          labelIdentifierValue="Ada Lovelace"
          linkedObjectMetadataItem={null}
          mainObjectMetadataItem={{} as EnrichedObjectMetadataItem}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });
});
