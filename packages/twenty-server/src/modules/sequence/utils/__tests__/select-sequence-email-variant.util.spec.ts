import { type SequenceEmailVariant } from 'twenty-shared/types';

import { selectSequenceEmailVariant } from 'src/modules/sequence/utils/select-sequence-email-variant.util';

const variants: SequenceEmailVariant[] = [
  {
    id: 'variant-a',
    name: 'A',
    subject: 'Subject A',
    bodyHtml: '<p>Body A</p>',
    weight: 25,
  },
  {
    id: 'variant-b',
    name: 'B',
    subject: 'Subject B',
    bodyHtml: '<p>Body B</p>',
    weight: 75,
  },
];

describe('selectSequenceEmailVariant', () => {
  it('returns the same weighted assignment for the same enrollment and step', () => {
    const input = {
      enrollmentId: 'enrollment-id',
      stepId: 'step-id',
      variants,
    };

    expect(selectSequenceEmailVariant(input)).toEqual(
      selectSequenceEmailVariant(input),
    );
  });

  it('uses the configured relative weights', () => {
    const assignments = Array.from({ length: 1_000 }, (_, index) =>
      selectSequenceEmailVariant({
        enrollmentId: `enrollment-${index}`,
        stepId: 'step-id',
        variants,
      }),
    );
    const variantACount = assignments.filter(
      (variant) => variant?.id === 'variant-a',
    ).length;
    const variantBCount = assignments.filter(
      (variant) => variant?.id === 'variant-b',
    ).length;

    expect(variantACount).toBeGreaterThan(200);
    expect(variantACount).toBeLessThan(300);
    expect(variantBCount).toBe(1_000 - variantACount);
  });

  it.each([
    undefined,
    [],
    [variants[0]],
    [...variants, variants[0]],
    [{ ...variants[0], weight: 0 }, variants[1]],
  ])('falls back to the legacy draft for invalid variants: %p', (input) => {
    expect(
      selectSequenceEmailVariant({
        enrollmentId: 'enrollment-id',
        stepId: 'step-id',
        variants: input,
      }),
    ).toBeUndefined();
  });
});
