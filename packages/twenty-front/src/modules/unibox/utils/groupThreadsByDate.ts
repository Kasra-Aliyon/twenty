import { differenceInCalendarDays } from 'date-fns';

import { type UniboxThread } from '@/unibox/types/UniboxThread';

export type UniboxThreadDateGroupLabel =
  | 'Today'
  | 'Yesterday'
  | 'Last 7 days'
  | 'Last 30 days'
  | 'Older';

const GROUP_LABELS: UniboxThreadDateGroupLabel[] = [
  'Today',
  'Yesterday',
  'Last 7 days',
  'Last 30 days',
  'Older',
];

export const getThreadDateGroup = (
  date: string,
  now = new Date(),
): UniboxThreadDateGroupLabel => {
  const daysAgo = differenceInCalendarDays(now, new Date(date));

  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo <= 7) return 'Last 7 days';
  if (daysAgo <= 30) return 'Last 30 days';

  return 'Older';
};

export const groupThreadsByDate = (
  threads: UniboxThread[],
  now = new Date(),
) => {
  const groups = new Map<UniboxThreadDateGroupLabel, UniboxThread[]>();

  for (const thread of threads) {
    const label = getThreadDateGroup(thread.lastMessageAt, now);
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }

  return GROUP_LABELS.filter((label) => groups.has(label)).map((label) => ({
    label,
    threads: groups.get(label) ?? [],
  }));
};
