import type {
  LinkedInSafetySettings,
  LinkedInSafetySnapshot,
  LinkedInSafetyState,
} from '../types';
import {
  getLinkedInOutboundSafetyDecision,
  getLinkedInReadSafetyDecision,
  LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY,
  LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
  LINKEDIN_RESTRICTION_COOLDOWN_MILLISECONDS,
  pruneLinkedInSafetyState,
  type LinkedInSafetyDecision,
} from './linkedin-safety-policy';

const LINKEDIN_SAFETY_STATE_KEY = 'twentyLinkedinSafetyState';
const LINKEDIN_SAFETY_SETTINGS_KEY = 'twentyLinkedinSafetySettings';
const HOUR_MILLISECONDS = 60 * 60_000;
let linkedinSafetyOperation: Promise<void> = Promise.resolve();

const withLinkedInSafetyStore = <TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const result = linkedinSafetyOperation.then(operation, operation);

  linkedinSafetyOperation = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
};

export class LinkedInSafetyLimitError extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
    this.name = 'LinkedInSafetyLimitError';
  }
}

const getStoredState = async (): Promise<LinkedInSafetyState> => {
  const storedValue = await browser.storage.local.get(
    LINKEDIN_SAFETY_STATE_KEY,
  );
  const storedState = storedValue[LINKEDIN_SAFETY_STATE_KEY] as
    | Partial<LinkedInSafetyState>
    | undefined;
  const readRequestTimestamps = Array.isArray(
    storedState?.readRequestTimestamps,
  )
    ? storedState.readRequestTimestamps.filter(
        (timestamp): timestamp is number =>
          typeof timestamp === 'number' && Number.isFinite(timestamp),
      )
    : [];
  const outboundAttempts = Array.isArray(storedState?.outboundAttempts)
    ? storedState.outboundAttempts.filter(
        (attempt) =>
          typeof attempt?.actionId === 'string' &&
          typeof attempt.attemptedAt === 'number' &&
          Number.isFinite(attempt.attemptedAt),
      )
    : [];

  return {
    readRequestTimestamps,
    outboundAttempts,
    cooldownUntil:
      typeof storedState?.cooldownUntil === 'number' &&
      Number.isFinite(storedState.cooldownUntil)
        ? storedState.cooldownUntil
        : null,
    cooldownReason:
      typeof storedState?.cooldownReason === 'string'
        ? storedState.cooldownReason
        : null,
  };
};

const saveState = async (state: LinkedInSafetyState): Promise<void> => {
  await browser.storage.local.set({ [LINKEDIN_SAFETY_STATE_KEY]: state });
};

const normalizeDailyOutboundLimit = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(
        LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY,
        Math.max(1, Math.floor(value)),
      )
    : LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY;

const getStoredSettings = async (): Promise<LinkedInSafetySettings> => {
  const storedValue = await browser.storage.local.get(
    LINKEDIN_SAFETY_SETTINGS_KEY,
  );
  const storedSettings = storedValue[LINKEDIN_SAFETY_SETTINGS_KEY] as
    | Partial<LinkedInSafetySettings>
    | undefined;

  return {
    dailyOutboundLimit: normalizeDailyOutboundLimit(
      storedSettings?.dailyOutboundLimit,
    ),
  };
};

const throwIfBlocked = (decision: LinkedInSafetyDecision): void => {
  if (!decision.allowed) {
    throw new LinkedInSafetyLimitError(decision.reason, decision.retryAt);
  }
};

export const reserveLinkedInReadRequest = async (
  now = Date.now(),
): Promise<void> =>
  withLinkedInSafetyStore(async () => {
    const state = pruneLinkedInSafetyState(await getStoredState(), now);

    throwIfBlocked(getLinkedInReadSafetyDecision(state, now));
    state.readRequestTimestamps.push(now);
    await saveState(state);
  });

export const assertLinkedInOutboundAllowed = async (
  actionId: string,
  now = Date.now(),
): Promise<void> =>
  withLinkedInSafetyStore(async () => {
    const settings = await getStoredSettings();

    throwIfBlocked(
      getLinkedInOutboundSafetyDecision(
        await getStoredState(),
        actionId,
        now,
        settings.dailyOutboundLimit,
      ),
    );
  });

export const getLinkedInSafetySettings =
  async (): Promise<LinkedInSafetySettings> =>
    withLinkedInSafetyStore(getStoredSettings);

export const setLinkedInSafetySettings = async (
  settings: Partial<LinkedInSafetySettings>,
): Promise<LinkedInSafetySettings> =>
  withLinkedInSafetyStore(async () => {
    const nextSettings = {
      dailyOutboundLimit: normalizeDailyOutboundLimit(
        settings.dailyOutboundLimit,
      ),
    };

    await browser.storage.local.set({
      [LINKEDIN_SAFETY_SETTINGS_KEY]: nextSettings,
    });

    return nextSettings;
  });

export const recordLinkedInOutboundAttempt = async (
  actionId: string,
  attemptedAt = Date.now(),
): Promise<void> =>
  withLinkedInSafetyStore(async () => {
    const state = pruneLinkedInSafetyState(await getStoredState(), attemptedAt);

    if (
      !state.outboundAttempts.some((attempt) => attempt.actionId === actionId)
    ) {
      state.outboundAttempts.push({ actionId, attemptedAt });
      await saveState(state);
    }
  });

export const tripLinkedInSafetyCircuit = async (
  reason: string,
  cooldownMilliseconds = LINKEDIN_RESTRICTION_COOLDOWN_MILLISECONDS,
): Promise<void> =>
  withLinkedInSafetyStore(async () => {
    const now = Date.now();
    const state = pruneLinkedInSafetyState(await getStoredState(), now);

    state.cooldownUntil = Math.max(
      state.cooldownUntil ?? 0,
      now + cooldownMilliseconds,
    );
    state.cooldownReason = reason;
    await saveState(state);
  });

export const getLinkedInSafetySnapshot = async (
  now = Date.now(),
): Promise<LinkedInSafetySnapshot> =>
  withLinkedInSafetyStore(async () => {
    const state = pruneLinkedInSafetyState(await getStoredState(), now);
    const settings = await getStoredSettings();
    const dayStart = new Date(now);

    dayStart.setHours(0, 0, 0, 0);
    const lastOutboundAttemptAt = state.outboundAttempts.reduce(
      (latest, attempt) => Math.max(latest, attempt.attemptedAt),
      0,
    );

    return {
      readRequestsLastHour: state.readRequestTimestamps.filter(
        (timestamp) => now - timestamp < HOUR_MILLISECONDS,
      ).length,
      readRequestsToday: state.readRequestTimestamps.filter(
        (timestamp) => timestamp >= dayStart.getTime(),
      ).length,
      outboundAttemptsToday: state.outboundAttempts.filter(
        ({ attemptedAt }) => attemptedAt >= dayStart.getTime(),
      ).length,
      outboundDailyLimit: settings.dailyOutboundLimit,
      nextOutboundAt:
        lastOutboundAttemptAt > 0
          ? lastOutboundAttemptAt + LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS
          : null,
      cooldownUntil: state.cooldownUntil,
      cooldownReason: state.cooldownReason,
    };
  });
