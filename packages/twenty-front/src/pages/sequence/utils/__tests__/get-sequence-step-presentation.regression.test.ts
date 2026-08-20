import { SEQUENCE_CONDITION_TYPES } from 'twenty-shared/types';

import { getSequenceConditionLabel } from '~/pages/sequence/utils/get-sequence-step-presentation';

describe('LinkedIn condition presentation', () => {
  it('describes the read-or-replied semantics', () => {
    expect(
      getSequenceConditionLabel(
        SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE,
      ),
    ).toBe('Read or replied to LinkedIn message');
  });
});
