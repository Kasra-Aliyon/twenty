import { SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS } from 'src/modules/sequence/sequence.constants';
import { hasLiveSequenceEmailSendLease } from 'src/modules/sequence/utils/has-live-sequence-email-send-lease.util';

describe('hasLiveSequenceEmailSendLease', () => {
  const stepId = 'email-step-id';
  const originalAttemptAt = new Date('2026-08-17T10:00:00.000Z');
  const renewedAttemptAt = new Date('2026-08-17T10:11:00.000Z');
  const afterOriginalLease = new Date('2026-08-17T10:15:00.000Z');

  it('uses a renewed heartbeat after the original scheduling lease expires', () => {
    expect(
      hasLiveSequenceEmailSendLease({
        enrollment: {
          lastSendAttempt: {
            stepId,
            attemptedAt: renewedAttemptAt.toISOString(),
          },
          nextActionAt: new Date(
            originalAttemptAt.getTime() +
              SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
          ),
          sentEmailsByStepId: {},
        },
        now: afterOriginalLease,
      }),
    ).toBe(true);
  });

  it('uses the renewed heartbeat when archive clears nextActionAt', () => {
    expect(
      hasLiveSequenceEmailSendLease({
        enrollment: {
          lastSendAttempt: {
            stepId,
            attemptedAt: renewedAttemptAt.toISOString(),
          },
          nextActionAt: null,
          sentEmailsByStepId: {},
        },
        now: afterOriginalLease,
      }),
    ).toBe(true);
  });
});
