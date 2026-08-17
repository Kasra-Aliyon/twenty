import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STEP_TYPES,
} from 'twenty-shared/types';

import { buildSequenceAnalytics } from 'src/modules/sequence/utils/build-sequence-analytics.util';

describe('buildSequenceAnalytics', () => {
  it('attributes sends and replies to deterministic email variants', () => {
    const analytics = buildSequenceAnalytics({
      steps: [
        {
          id: '4bf2b74a-1415-48ab-963a-c9a0bb314fec',
          name: 'Introduction',
          position: 0,
          settings: {
            type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
            subject: 'Legacy subject',
            bodyHtml: 'Legacy body',
            threadAsReplyToPreviousEmail: false,
            stopOnReply: null,
            variants: [
              {
                id: 'variant-a',
                name: 'A',
                subject: 'Subject A',
                bodyHtml: 'Body A',
                weight: 50,
              },
              {
                id: 'variant-b',
                name: 'B',
                subject: 'Subject B',
                bodyHtml: 'Body B',
                weight: 50,
              },
            ],
          },
        },
      ],
      enrollments: [
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          sentEmailsByStepId: {
            '4bf2b74a-1415-48ab-963a-c9a0bb314fec': {
              headerMessageId: 'message-a',
              threadExternalId: 'thread-a',
              sentAt: '2026-08-17T10:00:00.000Z',
              variantId: 'variant-a',
              variantName: 'A',
              repliedAt: '2026-08-17T11:00:00.000Z',
            },
          },
        },
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
          sentEmailsByStepId: {
            '4bf2b74a-1415-48ab-963a-c9a0bb314fec': {
              headerMessageId: 'message-b',
              threadExternalId: 'thread-b',
              sentAt: '2026-08-17T10:05:00.000Z',
              variantId: 'variant-b',
              variantName: 'B',
            },
          },
        },
      ],
    });

    expect(analytics).toMatchObject({
      enrolledCount: 2,
      contactedCount: 2,
      sentEmailCount: 2,
      repliedCount: 1,
      completedCount: 1,
      failedCount: 0,
      replyRate: 50,
      emailVariants: [
        {
          variantId: 'variant-a',
          sentCount: 1,
          repliedCount: 1,
          replyRate: 100,
        },
        {
          variantId: 'variant-b',
          sentCount: 1,
          repliedCount: 0,
          replyRate: 0,
        },
      ],
    });
  });

  it('does not infer an email variant reply from a channel-agnostic replied status', () => {
    const analytics = buildSequenceAnalytics({
      steps: [],
      enrollments: [
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          sentEmailsByStepId: {
            'step-1': {
              headerMessageId: 'message-1',
              threadExternalId: 'thread-1',
              sentAt: '2026-08-17T10:00:00.000Z',
            },
            'step-2': {
              headerMessageId: 'message-2',
              threadExternalId: 'thread-2',
              sentAt: '2026-08-17T11:00:00.000Z',
            },
          },
        },
      ],
    });

    expect(analytics).toMatchObject({ repliedCount: 1, replyRate: 100 });
    expect(analytics.emailVariants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'step-1', repliedCount: 0 }),
        expect.objectContaining({ stepId: 'step-2', repliedCount: 0 }),
      ]),
    );
  });
});
