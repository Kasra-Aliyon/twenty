import { isDefined } from 'twenty-shared/utils';

import { SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS } from 'src/modules/sequence/sequence.constants';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

export const hasLiveSequenceEmailSendLease = ({
  enrollment,
  now,
}: {
  enrollment: Pick<
    SequenceEnrollmentWorkspaceEntity,
    'lastSendAttempt' | 'nextActionAt' | 'sentEmailsByStepId'
  >;
  now: Date;
}): boolean => {
  const lastSendAttempt = enrollment.lastSendAttempt;

  if (
    !isDefined(lastSendAttempt) ||
    isDefined(enrollment.sentEmailsByStepId?.[lastSendAttempt.stepId])
  ) {
    return false;
  }

  const attemptedAt = Date.parse(lastSendAttempt.attemptedAt);
  const heartbeatLeaseExpiresAt = Number.isNaN(attemptedAt)
    ? 0
    : attemptedAt + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS;
  const leaseExpiresAt = Math.max(
    enrollment.nextActionAt?.getTime() ?? 0,
    heartbeatLeaseExpiresAt,
  );

  return leaseExpiresAt > now.getTime();
};
