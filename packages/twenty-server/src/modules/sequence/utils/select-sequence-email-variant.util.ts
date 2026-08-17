import { createHash } from 'crypto';

import { type SequenceEmailVariant } from 'twenty-shared/types';

const HASH_BUCKET_COUNT = 2 ** 32;

export const selectSequenceEmailVariant = ({
  enrollmentId,
  stepId,
  variants,
}: {
  enrollmentId: string;
  stepId: string;
  variants: SequenceEmailVariant[] | undefined;
}): SequenceEmailVariant | undefined => {
  if (
    variants?.length !== 2 ||
    variants.some(
      ({ weight }) =>
        typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0,
    )
  ) {
    return undefined;
  }

  const totalWeight = variants.reduce(
    (weightSum, variant) => weightSum + variant.weight,
    0,
  );
  const hashValue = createHash('sha256')
    .update(`${enrollmentId}:${stepId}`)
    .digest()
    .readUInt32BE(0);
  const weightedBucket = (hashValue / HASH_BUCKET_COUNT) * totalWeight;
  let cumulativeWeight = 0;

  for (const variant of variants) {
    cumulativeWeight += variant.weight;

    if (weightedBucket < cumulativeWeight) {
      return variant;
    }
  }

  return variants[variants.length - 1];
};
