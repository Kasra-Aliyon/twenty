import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
  type SequenceSettings,
} from 'twenty-shared/types';

import { SettingsOutreachSequenceLimits } from '@/settings/outreach/components/SettingsOutreachSequenceLimits';

const mockUpdateOneRecord = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();
let mockSendWindowTimezoneMode: SequenceSettings['sendWindowTimezoneMode'] =
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT;
let mockActiveDays = [1, 2, 3, 4, 5];

const mockBuildSettings = (): SequenceSettings => ({
  activeDays: mockActiveDays,
  windowStart: '09:00',
  windowEnd: '17:00',
  timezone: 'Not/A-Timezone',
  sendWindowTimezoneMode: mockSendWindowTimezoneMode,
  senderConnectedAccountIds: [],
  dailyStartLimitEnabled: false,
  dailyStarts: 25,
  staggerMinutes: 5,
  linkedinDailyActionLimitEnabled: false,
  linkedinDailyActions: 20,
  linkedinDelayPatternMinutes: [1, 2, 3],
  stopOnReply: true,
});

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: () => ({
    objectMetadataItem: { id: 'sequence-metadata-id' },
    records: [
      {
        id: 'sequence-id',
        name: 'Sequence',
        status: SEQUENCE_STATUSES.DRAFT,
        settings: mockBuildSettings(),
      },
    ],
    refetch: jest.fn(),
    loading: false,
  }),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
  }),
}));

jest.mock('@/ui/input/components/Select', () => ({
  Select: ({ label }: { label: string }) => <div>{label}</div>,
}));

jest.mock('../SettingsOutreachSequenceScheduleCard', () => ({
  SettingsOutreachSequenceScheduleCard: () => null,
}));

jest.mock('../SettingsOutreachSequenceLimitCard', () => ({
  SettingsOutreachSequenceLimitCard: () => null,
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
}));

jest.mock('twenty-ui/layout', () => ({
  Section: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('twenty-ui/typography', () => ({
  H2Title: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

describe('SettingsOutreachSequenceLimits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOneRecord.mockResolvedValue({});
    mockSendWindowTimezoneMode = SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT;
    mockActiveDays = [1, 2, 3, 4, 5];
  });

  it('allows recipient-local mode when the unused fixed timezone is invalid', async () => {
    render(<SettingsOutreachSequenceLimits />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Save schedule and limits' }),
    );

    await waitFor(() => {
      expect(mockUpdateOneRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          objectNameSingular: 'sequence',
          idToUpdate: 'sequence-id',
          updateOneRecordInput: {
            settings: expect.objectContaining({
              sendWindowTimezoneMode:
                SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
            }),
          },
        }),
      );
    });
    expect(mockEnqueueErrorSnackBar).not.toHaveBeenCalled();
  });

  it('rejects an invalid fixed timezone in sequence-local mode', () => {
    mockSendWindowTimezoneMode = SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE;

    render(<SettingsOutreachSequenceLimits />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Save schedule and limits' }),
    );

    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
    expect(mockEnqueueErrorSnackBar).toHaveBeenCalledWith({
      message: 'Enter a valid IANA timezone such as Europe/Helsinki.',
    });
  });

  it('rejects a schedule without an active day', () => {
    mockActiveDays = [];

    render(<SettingsOutreachSequenceLimits />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Save schedule and limits' }),
    );

    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
    expect(mockEnqueueErrorSnackBar).toHaveBeenCalledWith({
      message: 'Choose at least one active day.',
    });
  });
});
