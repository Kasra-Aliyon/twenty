import { describe, expect, it } from 'vitest';

import type { LinkedInSafetyState } from '../../types';
import {
  emptyLinkedInSafetyState,
  getLinkedInOutboundSafetyDecision,
  getLinkedInReadSafetyDecision,
  isLinkedInRestrictionUrl,
  LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY,
  LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
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

  it('enforces a cross-sequence outbound gap and daily cap', () => {
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

    const cappedState = buildState({
      outboundAttempts: Array.from(
        { length: LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY },
        (_, index) => ({
          actionId: `action-${index}`,
          attemptedAt:
            NOW -
            (LINKEDIN_OUTBOUND_ATTEMPTS_PER_DAY - index) *
              LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
        }),
      ),
    });

    expect(
      getLinkedInOutboundSafetyDecision(cappedState, 'next-action', NOW),
    ).toMatchObject({
      allowed: false,
      reason: 'Daily LinkedIn automation limit reached.',
    });
  });

  it('supports a lower user-configured outbound limit', () => {
    const state = buildState({
      outboundAttempts: Array.from({ length: 5 }, (_, index) => ({
        actionId: 'action-' + index,
        attemptedAt:
          NOW - (5 - index) * LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
      })),
    });

    expect(
      getLinkedInOutboundSafetyDecision(state, 'next-action', NOW, 5),
    ).toMatchObject({
      allowed: false,
      reason: 'Daily LinkedIn automation limit reached.',
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
