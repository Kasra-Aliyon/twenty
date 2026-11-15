import { render, screen } from '@testing-library/react';

import { UniboxLinkedInReadStatus } from '~/pages/unibox/components/UniboxLinkedInReadStatus';

describe('UniboxLinkedInReadStatus', () => {
  it('should show when the recipient saw an outbound message', () => {
    render(
      <UniboxLinkedInReadStatus
        direction="OUTBOUND"
        recipientReadAt="2026-11-15T10:05:00.000Z"
      />,
    );

    expect(screen.getByText('Seen 15 Nov 2026, 10:05')).toBeInTheDocument();
  });

  it.each([null, '', 'invalid-date'])(
    'should show unknown when the receipt timestamp is %s',
    (recipientReadAt) => {
      render(
        <UniboxLinkedInReadStatus
          direction="OUTBOUND"
          recipientReadAt={recipientReadAt}
        />,
      );

      expect(screen.getByText('Read status unknown')).toBeInTheDocument();
      expect(screen.queryByText(/unread|not seen/i)).not.toBeInTheDocument();
    },
  );

  it('should omit recipient status on inbound messages', () => {
    const { container } = render(
      <UniboxLinkedInReadStatus
        direction="INBOUND"
        recipientReadAt="2026-11-15T10:05:00.000Z"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
