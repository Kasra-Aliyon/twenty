import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';

import { SettingsOutreachSequenceLimitCard } from '@/settings/outreach/components/SettingsOutreachSequenceLimitCard';

jest.mock('@/settings/components/SettingsCounter', () => ({
  SettingsCounter: () => null,
}));

jest.mock('twenty-ui/input', () => ({
  Toggle: () => null,
}));

jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const buildSettings = (
  sendWindowTimezoneMode: SequenceSettings['sendWindowTimezoneMode'],
): SequenceSettings => ({
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: 'Europe/Helsinki',
  sendWindowTimezoneMode,
  senderConnectedAccountIds: [],
  dailyStartLimitEnabled: true,
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActionLimitEnabled: false,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 2, 3],
  stopOnReply: true,
});

describe('SettingsOutreachSequenceLimitCard', () => {
  it('explains the quota day used by each timezone mode', () => {
    const { rerender } = render(
      <SettingsOutreachSequenceLimitCard
        settings={buildSettings(SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE)}
        disabled={false}
        onChange={jest.fn()}
      />,
    );

    expect(
      screen.getByText(/per day in the sequence time zone/),
    ).toBeInTheDocument();

    rerender(
      <SettingsOutreachSequenceLimitCard
        settings={buildSettings(SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT)}
        disabled={false}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText(/per UTC day/)).toBeInTheDocument();
  });
});
