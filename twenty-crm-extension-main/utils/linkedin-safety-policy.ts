import type { LinkedInSafetyState } from '../types';

export const LINKEDIN_READ_REQUESTS_PER_HOUR = 60;
export const LINKEDIN_READ_REQUESTS_PER_DAY = 200;
export const LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY = 20;
export const LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS = 15 * 60_000;
export const LINKEDIN_RESTRICTION_COOLDOWN_MILLISECONDS = 24 * 60 * 60_000;

const HOUR_MILLISECONDS = 60 * 60_000;
const DAY_MILLISECONDS = 24 * HOUR_MILLISECONDS;

export const emptyLinkedInSafetyState = (): LinkedInSafetyState => ({
  readRequestTimestamps: [],
  outboundAttempts: [],
  cooldownUntil: null,
  cooldownReason: null,
});

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp);

  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const pruneLinkedInSafetyState = (
  state: LinkedInSafetyState,
  now: number,
): LinkedInSafetyState => {
  return {
    readRequestTimestamps: state.readRequestTimestamps.filter(
      (timestamp) => now - timestamp < DAY_MILLISECONDS && timestamp <= now,
    ),
    outboundAttempts: state.outboundAttempts.filter(
      ({ attemptedAt }) =>
        now - attemptedAt < DAY_MILLISECONDS && attemptedAt <= now,
    ),
    cooldownUntil:
      state.cooldownUntil !== null && state.cooldownUntil > now
        ? state.cooldownUntil
        : null,
    cooldownReason:
      state.cooldownUntil !== null && state.cooldownUntil > now
        ? state.cooldownReason
        : null,
  };
};

export type LinkedInSafetyDecision =
  | { allowed: true }
  | { allowed: false; retryAt: number; reason: string };

export const getLinkedInReadSafetyDecision = (
  rawState: LinkedInSafetyState,
  now: number,
): LinkedInSafetyDecision => {
  const state = pruneLinkedInSafetyState(rawState, now);

  if (state.cooldownUntil !== null) {
    return {
      allowed: false,
      retryAt: state.cooldownUntil,
      reason:
        state.cooldownReason ??
        'LinkedIn safety cooldown is active after a restriction response.',
    };
  }

  const requestsLastHour = state.readRequestTimestamps.filter(
    (timestamp) => now - timestamp < HOUR_MILLISECONDS,
  );

  if (requestsLastHour.length >= LINKEDIN_READ_REQUESTS_PER_HOUR) {
    return {
      allowed: false,
      retryAt: requestsLastHour[0] + HOUR_MILLISECONDS,
      reason: 'Hourly read limit reached. Sync will resume automatically.',
    };
  }

  const requestsToday = state.readRequestTimestamps.filter(
    (timestamp) => timestamp >= startOfLocalDay(now),
  );

  if (requestsToday.length >= LINKEDIN_READ_REQUESTS_PER_DAY) {
    return {
      allowed: false,
      retryAt: startOfLocalDay(now) + DAY_MILLISECONDS,
      reason: 'Daily read limit reached. Sync will resume automatically.',
    };
  }

  return { allowed: true };
};

export const getLinkedInOutboundSafetyDecision = (
  rawState: LinkedInSafetyState,
  actionId: string,
  now: number,
  dailyOutboundLimit = LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY,
): LinkedInSafetyDecision => {
  const state = pruneLinkedInSafetyState(rawState, now);
  const effectiveDailyOutboundLimit = Math.min(
    LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY,
    Math.max(1, Math.floor(dailyOutboundLimit)),
  );
  const attemptsToday = state.outboundAttempts.filter(
    ({ attemptedAt }) => attemptedAt >= startOfLocalDay(now),
  );

  if (state.cooldownUntil !== null) {
    return {
      allowed: false,
      retryAt: state.cooldownUntil,
      reason:
        state.cooldownReason ??
        'LinkedIn safety cooldown is active after a restriction response.',
    };
  }

  if (state.outboundAttempts.some((attempt) => attempt.actionId === actionId)) {
    return {
      allowed: false,
      retryAt: startOfLocalDay(now) + DAY_MILLISECONDS,
      reason:
        'This action was already attempted today and will not be replayed automatically.',
    };
  }

  if (attemptsToday.length >= effectiveDailyOutboundLimit) {
    return {
      allowed: false,
      retryAt: startOfLocalDay(now) + DAY_MILLISECONDS,
      reason: 'Daily LinkedIn automation limit reached.',
    };
  }

  const lastAttemptAt = state.outboundAttempts.reduce(
    (latest, attempt) => Math.max(latest, attempt.attemptedAt),
    0,
  );
  const nextAttemptAt =
    lastAttemptAt + LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS;

  if (lastAttemptAt > 0 && nextAttemptAt > now) {
    return {
      allowed: false,
      retryAt: nextAttemptAt,
      reason: 'Waiting for the LinkedIn safety interval.',
    };
  }

  return { allowed: true };
};

export const isLinkedInRestrictionUrl = (url: string): boolean => {
  try {
    const path = new URL(url).pathname.toLowerCase();

    return ['/checkpoint/', '/challenge/', '/uas/login', '/authwall'].some(
      (restrictedPath) => path.includes(restrictedPath),
    );
  } catch {
    return false;
  }
};
