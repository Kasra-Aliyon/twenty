import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  type SequenceSettings,
} from 'twenty-shared/types';

import { SettingsOutreachSequenceScheduleCard } from '@/settings/outreach/components/SettingsOutreachSequenceScheduleCard';

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('@/ui/input/components/SettingsTextInput', () => ({
  SettingsTextInput: ({
    label,
    value,
    disabled,
  }: {
    label: string;
    value: string;
    disabled?: boolean;
  }) => <input aria-label={label} value={value} disabled={disabled} readOnly />,
}));

jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const buildSettings = (
  overrides: Partial<SequenceSettings> = {},
): SequenceSettings => ({
  activeDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: 'Europe/Helsinki',
  sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
  senderConnectedAccountIds: [],
  dailyStartLimitEnabled: false,
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActionLimitEnabled: false,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 2, 3],
  stopOnReply: true,
  ...overrides,
});

describe('SettingsOutreachSequenceScheduleCard', () => {
  it('updates the send-window timezone mode', () => {
    const onChange = jest.fn();

    render(
      <SettingsOutreachSequenceScheduleCard
        settings={buildSettings()}
        disabled={false}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Apply email window in'), {
      target: { value: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT },
    });

    expect(onChange).toHaveBeenCalledWith({
      sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
    });
  });

  it('keeps the sequence timezone editable and explains split scheduling in recipient mode', () => {
    render(
      <SettingsOutreachSequenceScheduleCard
        settings={buildSettings({
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        })}
        disabled={false}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Sequence time zone')).toBeEnabled();
    expect(
      screen.getByLabelText('LinkedIn and task window starts'),
    ).toHaveValue('09:00');
    expect(screen.getByLabelText('Email window starts')).toHaveValue('09:00');
    expect(
      screen.getByText(/Missing or invalid values fall back to UTC/),
    ).toBeInTheDocument();
  });

  it('shows distinct task and email windows', () => {
    render(
      <SettingsOutreachSequenceScheduleCard
        settings={buildSettings({
          windowStart: '10:00',
          windowEnd: '18:00',
          emailWindowStart: '08:00',
          emailWindowEnd: '16:00',
        })}
        disabled={false}
        onChange={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText('LinkedIn and task window starts'),
    ).toHaveValue('10:00');
    expect(screen.getByLabelText('LinkedIn and task window ends')).toHaveValue(
      '18:00',
    );
    expect(screen.getByLabelText('Email window starts')).toHaveValue('08:00');
    expect(screen.getByLabelText('Email window ends')).toHaveValue('16:00');
  });
});
