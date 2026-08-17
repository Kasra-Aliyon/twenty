import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STEP_TYPES,
  type SequenceEmailStepSettings,
  type SequenceEnrollmentStatus,
} from 'twenty-shared/types';

import { type SequenceAnalyticsDTO } from 'src/modules/sequence/dtos/sequence-analytics.dto';
import { type SequenceSentEmailMetadata } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type SequenceEmailVariant = {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  weight: number;
};

type EmailSettingsWithVariants = SequenceEmailStepSettings & {
  variants?: SequenceEmailVariant[];
};

type AnalyticsEnrollment = {
  status: SequenceEnrollmentStatus;
  sentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
};

type AnalyticsStep = {
  id: string;
  name: string | null;
  position: number;
  settings: unknown;
};

type VariantBucket = SequenceAnalyticsDTO['emailVariants'][number];

const DEFAULT_VARIANT_ID = 'default';
const DEFAULT_VARIANT_NAME = 'Default';

const getReplyRate = ({
  repliedCount,
  sentCount,
}: {
  repliedCount: number;
  sentCount: number;
}): number => (sentCount === 0 ? 0 : (repliedCount / sentCount) * 100);

const isEmailStepSettings = (
  settings: unknown,
): settings is EmailSettingsWithVariants =>
  typeof settings === 'object' &&
  settings !== null &&
  'type' in settings &&
  settings.type === SEQUENCE_STEP_TYPES.SEND_EMAIL;

const getVariantDefinitions = (
  settings: EmailSettingsWithVariants,
): Array<{ id: string; name: string }> => {
  if (Array.isArray(settings.variants) && settings.variants.length > 0) {
    return settings.variants.map(({ id, name }) => ({ id, name }));
  }

  return [{ id: DEFAULT_VARIANT_ID, name: DEFAULT_VARIANT_NAME }];
};

export const buildSequenceAnalytics = ({
  enrollments,
  steps,
}: {
  enrollments: AnalyticsEnrollment[];
  steps: AnalyticsStep[];
}): SequenceAnalyticsDTO => {
  const buckets = new Map<string, VariantBucket>();

  for (const step of steps) {
    if (!isEmailStepSettings(step.settings)) {
      continue;
    }

    const stepName = step.name ?? `Email step ${step.position + 1}`;

    for (const variant of getVariantDefinitions(step.settings)) {
      buckets.set(`${step.id}:${variant.id}`, {
        stepId: step.id,
        stepName,
        variantId: variant.id,
        variantName: variant.name,
        sentCount: 0,
        repliedCount: 0,
        replyRate: 0,
      });
    }
  }

  let contactedCount = 0;
  let sentEmailCount = 0;

  for (const enrollment of enrollments) {
    const sentEntries = Object.entries(enrollment.sentEmailsByStepId ?? {});

    if (sentEntries.length > 0) {
      contactedCount += 1;
    }

    sentEmailCount += sentEntries.length;

    for (const [stepId, metadata] of sentEntries) {
      const variantId = metadata.variantId ?? DEFAULT_VARIANT_ID;
      const key = `${stepId}:${variantId}`;
      const existing = buckets.get(key);
      const bucket =
        existing ??
        ({
          stepId,
          stepName:
            steps.find((step) => step.id === stepId)?.name ?? 'Email step',
          variantId,
          variantName: metadata.variantName ?? DEFAULT_VARIANT_NAME,
          sentCount: 0,
          repliedCount: 0,
          replyRate: 0,
        } satisfies VariantBucket);

      bucket.sentCount += 1;

      if (metadata.repliedAt !== undefined) {
        bucket.repliedCount += 1;
      }

      buckets.set(key, bucket);
    }
  }

  const emailVariants = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      replyRate: getReplyRate(bucket),
    }))
    .sort((first, second) => {
      const firstPosition =
        steps.find((step) => step.id === first.stepId)?.position ?? 0;
      const secondPosition =
        steps.find((step) => step.id === second.stepId)?.position ?? 0;

      return (
        firstPosition - secondPosition ||
        first.variantName.localeCompare(second.variantName)
      );
    });
  const repliedCount = enrollments.filter(
    ({ status, sentEmailsByStepId }) =>
      status === SEQUENCE_ENROLLMENT_STATUSES.REPLIED ||
      Object.values(sentEmailsByStepId ?? {}).some(
        ({ repliedAt }) => repliedAt !== undefined,
      ),
  ).length;

  return {
    enrolledCount: enrollments.length,
    contactedCount,
    sentEmailCount,
    repliedCount,
    completedCount: enrollments.filter(
      ({ status }) => status === SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
    ).length,
    failedCount: enrollments.filter(
      ({ status }) => status === SEQUENCE_ENROLLMENT_STATUSES.FAILED,
    ).length,
    replyRate: getReplyRate({
      repliedCount,
      sentCount: enrollments.length,
    }),
    emailVariants,
  };
};
