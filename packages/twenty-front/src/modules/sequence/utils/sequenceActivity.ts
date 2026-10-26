import { t } from '@lingui/core/macro';
import { z } from 'zod';

export const CALL_OUTCOMES = [
  'NO_RESPONSE',
  'VOICEMAIL',
  'EMAIL_FOLLOW_UP',
  'CALL_BACK',
  'INTERESTED',
  'MEETING_BOOKED',
  'NOT_INTERESTED',
  'WRONG_NUMBER',
  'OTHER',
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const getCallOutcomeLabel = (outcome: CallOutcome) => {
  const labels = {
    NO_RESPONSE: t`No response`,
    VOICEMAIL: t`Voicemail`,
    EMAIL_FOLLOW_UP: t`Email follow-up`,
    CALL_BACK: t`Call back`,
    INTERESTED: t`Interested`,
    MEETING_BOOKED: t`Meeting booked`,
    NOT_INTERESTED: t`Not interested`,
    WRONG_NUMBER: t`Wrong number`,
    OTHER: t`Other`,
  };

  return labels[outcome];
};

export const MANUAL_SEQUENCE_ACTIVITIES = [
  'LINKEDIN_FOLLOWED',
  'LINKEDIN_COMMENTED',
  'LINKEDIN_LIKED',
  'LINKEDIN_CONNECTION_SENT',
  'LINKEDIN_CONNECTED',
  'LINKEDIN_MESSAGE_SENT',
  'EMAIL_SENT',
  'OTHER',
] as const;

export type ManualSequenceActivity =
  (typeof MANUAL_SEQUENCE_ACTIVITIES)[number];

export const getManualSequenceActivityLabel = (
  activity: ManualSequenceActivity,
) => {
  const labels = {
    LINKEDIN_FOLLOWED: t`LinkedIn followed`,
    LINKEDIN_COMMENTED: t`LinkedIn commented`,
    LINKEDIN_LIKED: t`LinkedIn liked`,
    LINKEDIN_CONNECTION_SENT: t`LinkedIn connection sent`,
    LINKEDIN_CONNECTED: t`LinkedIn connected`,
    LINKEDIN_MESSAGE_SENT: t`LinkedIn message sent`,
    EMAIL_SENT: t`Email sent`,
    OTHER: t`Other activity`,
  };

  return labels[activity];
};

export const sequenceActivityDetailsSchema = z.object({
  source: z.literal('manual'),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  activity: z.enum(MANUAL_SEQUENCE_ACTIVITIES).optional(),
  notes: z.string().max(2000),
  taskId: z.string().optional(),
  sequenceEnrollmentId: z.string().optional(),
});

export const readSequenceActivityDetails = (properties: unknown) => {
  try {
    const parsed = sequenceActivityDetailsSchema.safeParse(
      typeof properties === 'string' ? JSON.parse(properties) : properties,
    );

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

// Filter before pagination so profile edits cannot hide older interactions.
export const SEQUENCE_ACTIVITY_FILTER = {
  or: [
    { name: { like: 'sequence.%' } },
    { name: { like: 'linkedin.%' } },
    { name: { in: ['message.sent', 'message.received', 'message.linked'] } },
    { name: { like: 'linked-task.%' } },
  ],
};
