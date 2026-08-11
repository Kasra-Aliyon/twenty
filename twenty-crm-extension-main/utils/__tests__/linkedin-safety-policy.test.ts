import { describe, expect, it } from 'vitest';

import type { LinkedInSafetyState } from '../../types';
import {
  emptyLinkedInSafetyState,
  getLinkedInIdempotentRecoverySafetyDecision,
  getLinkedInOutboundSafetyDecision,
  getLinkedInReadSafetyDecision,
  isLinkedInRestrictionUrl,
  LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
  LINKEDIN_READ_REQUESTS_PER_DAY,
  LINKEDIN_READ_REQUESTS_PER_HOUR,
  pruneLinkedInSafetyState,
} from '../linkedin-safety-policy';

const NOW = new Date('2026-07-22T12:00:00.000Z').getTime();

const buildState = (
  overrides: Partial<LinkedInSafetyState> = {},
): LinkedInSafetyState => ({
  ...emptyLinkedInSafetyState(),
  ...overrides,
});

describe('LinkedIn safety policy', () => {
  it('blocks reads after the durable hourly request cap', () => {
    const state = buildState({
      readRequestTimestamps: Array.from(
        { length: LINKEDIN_READ_REQUESTS_PER_HOUR },
        (_, index) => NOW - 59 * 60_000 + index,
      ),
    });

    expect(getLinkedInReadSafetyDecision(state, NOW)).toMatchObject({
      allowed: false,
      reason: 'Hourly read limit reached. Sync will resume automatically.',
    });
  });

  it('makes only the daily read cap switchable', () => {
    const state = buildState({
      readRequestTimestamps: Array.from(
        { length: LINKEDIN_READ_REQUESTS_PER_DAY },
        (_, index) => NOW - 2 * 60 * 60_000 - index,
      ),
    });

    expect(getLinkedInReadSafetyDecision(state, NOW)).toMatchObject({
      allowed: false,
      reason: 'Daily read limit reached. Sync will resume automatically.',
    });
    expect(getLinkedInReadSafetyDecision(state, NOW, false)).toEqual({
      allowed: true,
    });
  });

  it('always enforces the cross-sequence outbound gap', () => {
    const recentAttemptState = buildState({
      outboundAttempts: [
        {
          actionId: 'first-sequence-action',
          attemptedAt: NOW - LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS + 1,
        },
      ],
    });

    expect(
      getLinkedInOutboundSafetyDecision(
        recentAttemptState,
        'second-sequence-action',
        NOW,
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'Waiting for the LinkedIn safety interval.',
    });
  });

  it('keeps restriction cooldowns and duplicate protection on', () => {
    expect(
      getLinkedInOutboundSafetyDecision(
        buildState({
          cooldownUntil: NOW + 60_000,
          cooldownReason: 'LinkedIn verification required.',
        }),
        'test-action',
        NOW,
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'LinkedIn verification required.',
    });

    expect(
      getLinkedInOutboundSafetyDecision(
        buildState({
          outboundAttempts: [{ actionId: 'test-action', attemptedAt: NOW - 1 }],
        }),
        'test-action',
        NOW,
      ),
    ).toMatchObject({
      allowed: false,
      reason:
        'This action was already attempted today and will not be replayed automatically.',
    });
  });

  it('does not replay an action already attempted today', () => {
    const state = buildState({
      outboundAttempts: [{ actionId: 'same-action', attemptedAt: NOW - 1 }],
    });

    expect(
      getLinkedInOutboundSafetyDecision(state, 'same-action', NOW),
    ).toMatchObject({
      allowed: false,
      reason:
        'This action was already attempted today and will not be replayed automatically.',
    });
  });

  it('allows only idempotent recovery after the mandatory gap', () => {
    const state = buildState({
      outboundAttempts: [
        {
          actionId: 'recoverable-action',
          attemptedAt: NOW - LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS + 1,
        },
      ],
    });

    expect(
      getLinkedInIdempotentRecoverySafetyDecision(
        state,
        'recoverable-action',
        NOW,
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'Waiting for the LinkedIn safety interval before recovery.',
    });
    expect(
      getLinkedInIdempotentRecoverySafetyDecision(
        state,
        'recoverable-action',
        NOW + LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
      ),
    ).toEqual({ allowed: true });
  });

  it('clears expired cooldowns and prior-day attempts', () => {
    const state = pruneLinkedInSafetyState(
      buildState({
        readRequestTimestamps: [NOW - 24 * 60 * 60_000],
        outboundAttempts: [
          { actionId: 'old-action', attemptedAt: NOW - 24 * 60 * 60_000 },
        ],
        cooldownUntil: NOW - 1,
        cooldownReason: 'expired',
      }),
      NOW,
    );

    expect(state).toEqual(emptyLinkedInSafetyState());
  });

  it('recognizes LinkedIn verification and restriction routes', () => {
    expect(
      isLinkedInRestrictionUrl(
        'https://www.linkedin.com/checkpoint/challenge/',
      ),
    ).toBe(true);
    expect(
      isLinkedInRestrictionUrl('https://www.linkedin.com/in/example/'),
    ).toBe(false);
  });
});
