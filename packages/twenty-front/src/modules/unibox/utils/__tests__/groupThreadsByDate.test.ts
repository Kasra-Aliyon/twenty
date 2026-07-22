import {
  getThreadDateGroup,
  groupThreadsByDate,
} from '@/unibox/utils/groupThreadsByDate';
import { type UniboxThread } from '@/unibox/types/UniboxThread';

const NOW = new Date('2026-07-22T12:00:00.000Z');

const makeThread = (id: string, lastMessageAt: string): UniboxThread => ({
  id,
  channel: 'EMAIL',
  subject: id,
  lastMessagePreview: '',
  lastMessageAt,
  messageCount: 1,
  isRead: true,
  participants: [],
  hasCrmContact: false,
  connectedAccountId: 'account-id',
});

describe('groupThreadsByDate', () => {
  it.each([
    ['2026-07-22T08:00:00.000Z', 'Today'],
    ['2026-07-21T08:00:00.000Z', 'Yesterday'],
    ['2026-07-16T08:00:00.000Z', 'Last 7 days'],
    ['2026-07-01T08:00:00.000Z', 'Last 30 days'],
    ['2026-06-01T08:00:00.000Z', 'Older'],
  ])('groups %s as %s', (date, expectedGroup) => {
    expect(getThreadDateGroup(date, NOW)).toBe(expectedGroup);
  });

  it('keeps the fixed group order and thread order', () => {
    const result = groupThreadsByDate(
      [
        makeThread('older', '2026-05-01T08:00:00.000Z'),
        makeThread('today-a', '2026-07-22T10:00:00.000Z'),
        makeThread('today-b', '2026-07-22T09:00:00.000Z'),
      ],
      NOW,
    );

    expect(result.map(({ label }) => label)).toEqual(['Today', 'Older']);
    expect(result[0].threads.map(({ id }) => id)).toEqual([
      'today-a',
      'today-b',
    ]);
  });
});
