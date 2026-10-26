import {
  CALL_OUTCOMES,
  getCallOutcomeLabel,
  readSequenceActivityDetails,
  SEQUENCE_ACTIVITY_FILTER,
} from '@/sequence/utils/sequenceActivity';

describe('sequence activity details', () => {
  it.each(CALL_OUTCOMES)('should support the %s call outcome', (outcome) => {
    expect(
      readSequenceActivityDetails({ source: 'manual', outcome, notes: '' })
        ?.outcome,
    ).toBe(outcome);
    expect(getCallOutcomeLabel(outcome)).toBeTruthy();
  });

  it('should read persisted JSON details', () => {
    expect(
      readSequenceActivityDetails(
        '{"source":"manual","activity":"LINKEDIN_COMMENTED","notes":"A thoughtful reply"}',
      ),
    ).toEqual({
      source: 'manual',
      activity: 'LINKEDIN_COMMENTED',
      notes: 'A thoughtful reply',
    });
  });

  it.each([
    null,
    'invalid JSON',
    { source: 'synced', outcome: 'INTERESTED', notes: '' },
    { source: 'manual', outcome: 'MADE_UP', notes: '' },
  ])('should handle unknown details safely (%j)', (properties) => {
    expect(readSequenceActivityDetails(properties)).toBeUndefined();
  });

  it('should query interaction history before pagination and exclude ordinary profile edits', () => {
    expect(SEQUENCE_ACTIVITY_FILTER.or).toContainEqual({
      name: { like: 'linkedin.%' },
    });
    expect(SEQUENCE_ACTIVITY_FILTER.or).toContainEqual({
      name: { like: 'sequence.%' },
    });
    expect(JSON.stringify(SEQUENCE_ACTIVITY_FILTER)).not.toContain(
      'person.updated',
    );
  });
});
