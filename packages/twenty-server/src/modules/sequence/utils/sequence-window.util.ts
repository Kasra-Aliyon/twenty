import { type SequenceSettings } from 'twenty-shared/types';

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
};

const WEEKDAY_NUMBER_BY_SHORT_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const getZonedDateParts = (date: Date, timeZone: string): ZonedDateParts => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_NUMBER_BY_SHORT_NAME[parts.weekday] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const parseTime = (value: string): { hour: number; minute: number } => {
  const [hour = 0, minute = 0] = value.split(':').map(Number);

  return { hour, minute };
};

const toMinuteOfDay = ({
  hour,
  minute,
}: {
  hour: number;
  minute: number;
}): number => hour * 60 + minute;

const previousWeekday = (weekday: number): number => (weekday + 6) % 7;

const addCalendarDays = (
  dateParts: Pick<ZonedDateParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<ZonedDateParts, 'year' | 'month' | 'day'> => {
  const date = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days),
  );

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const zonedDateTimeToUtc = ({
  year,
  month,
  day,
  hour,
  minute,
  timeZone,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): Date => {
  const desiredTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  let candidateTimestamp = desiredTimestamp;

  // Offset lookup is iterative so it follows the offset on the target local
  // date, including daylight-saving transitions.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const candidateParts = getZonedDateParts(
      new Date(candidateTimestamp),
      timeZone,
    );
    const candidateAsUtc = Date.UTC(
      candidateParts.year,
      candidateParts.month - 1,
      candidateParts.day,
      candidateParts.hour,
      candidateParts.minute,
    );
    const adjustment = desiredTimestamp - candidateAsUtc;

    if (adjustment === 0) {
      break;
    }

    candidateTimestamp += adjustment;
  }

  return new Date(candidateTimestamp);
};

export const isWithinSendingWindow = (
  date: Date,
  settings: SequenceSettings,
): boolean => {
  const parts = getZonedDateParts(date, settings.timezone);
  const currentMinute = toMinuteOfDay(parts);
  const startMinute = toMinuteOfDay(parseTime(settings.windowStart));
  const endMinute = toMinuteOfDay(parseTime(settings.windowEnd));
  const activeDays = new Set(settings.activeDays);

  if (startMinute === endMinute) {
    return activeDays.has(parts.weekday);
  }

  if (startMinute < endMinute) {
    return (
      activeDays.has(parts.weekday) &&
      currentMinute >= startMinute &&
      currentMinute <= endMinute
    );
  }

  if (currentMinute >= startMinute) {
    return activeDays.has(parts.weekday);
  }

  return (
    currentMinute <= endMinute && activeDays.has(previousWeekday(parts.weekday))
  );
};

export const startOfDayInTimezone = (date: Date, timeZone: string): Date => {
  const parts = getZonedDateParts(date, timeZone);

  return zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    timeZone,
  });
};

export const nextWindowOpen = (
  date: Date,
  settings: SequenceSettings,
): Date => {
  if (isWithinSendingWindow(date, settings)) {
    return date;
  }

  const currentParts = getZonedDateParts(date, settings.timezone);
  const start = parseTime(settings.windowStart);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const localDate = addCalendarDays(currentParts, dayOffset);
    const weekday = (currentParts.weekday + dayOffset) % 7;

    if (!settings.activeDays.includes(weekday)) {
      continue;
    }

    const candidate = zonedDateTimeToUtc({
      ...localDate,
      ...start,
      timeZone: settings.timezone,
    });

    if (candidate.getTime() >= date.getTime()) {
      return candidate;
    }
  }

  return date;
};
