import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';

import { EventRowMessage } from '@/activities/timeline-activities/rows/message/components/EventRowMessage';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';

jest.mock(
  '@/activities/timeline-activities/rows/components/EventCardToggleButton',
  () => ({ EventCardToggleButton: () => null }),
);

const buildEvent = (name: string) =>
  ({
    createdAt: '2026-08-13T09:00:00.000Z',
    happensAt: '2026-08-13T09:00:00.000Z',
    id: 'activity-id',
    linkedObjectMetadataId: 'message-metadata-id',
    linkedRecordId: 'message-id',
    name,
  }) as TimelineActivity;

describe('EventRowMessage', () => {
  it.each([
    ['message.sent', 'sent an email to'],
    ['message.received', 'received an email from'],
    ['message.linked', 'linked an email with'],
  ])('renders %s timeline interactions', (name, label) => {
    render(
      <I18nProvider i18n={i18n}>
        <EventRowMessage
          authorFullName="You"
          event={buildEvent(name)}
          labelIdentifierValue="Ada Lovelace"
          linkedObjectMetadataItem={null}
          mainObjectMetadataItem={{} as EnrichedObjectMetadataItem}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });
});
