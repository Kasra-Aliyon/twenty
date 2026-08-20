import { SEQUENCE_WAITING_ON } from '../../constants.js';
import { sequencesToolsTesting } from '../sequences.tools.js';

describe('sequence MCP contract regressions', () => {
  it('accepts explicit false and preserves the current condition expectation when omitted', () => {
    const explicitFalse = sequencesToolsTesting.stepInputSchema.parse({
      type: 'CONDITION',
      settings: {
        condition: 'HAS_EMAIL_ADDRESS',
        expected: false,
      },
    });

    expect(sequencesToolsTesting.stepData({ input: explicitFalse })).toEqual({
      type: 'CREATE_TASK',
      settings: {
        type: 'CONDITION',
        condition: 'HAS_EMAIL_ADDRESS',
        expected: false,
      },
    });

    const omittedExpected = sequencesToolsTesting.stepInputSchema.parse({
      type: 'CONDITION',
      settings: { condition: 'HAS_PHONE_NUMBER' },
    });
    const preserved = sequencesToolsTesting.withPreservedStepSettings({
      currentStep: {
        settings: {
          type: 'CONDITION',
          condition: 'HAS_EMAIL_ADDRESS',
          expected: false,
        },
      },
      input: omittedExpected,
    });

    expect(preserved.settings).toMatchObject({ expected: false });
  });

  it('enforces LinkedIn note and reorder bounds', () => {
    expect(
      sequencesToolsTesting.stepInputSchema.safeParse({
        type: 'SEND_CONNECTION_REQUEST',
        settings: { noteTemplate: 'x'.repeat(200) },
      }).success,
    ).toBe(true);
    expect(
      sequencesToolsTesting.stepInputSchema.safeParse({
        type: 'SEND_CONNECTION_REQUEST',
        settings: { noteTemplate: 'x'.repeat(201) },
      }).success,
    ).toBe(false);
    expect(
      sequencesToolsTesting.sequenceStepPositionSchema.safeParse(0).success,
    ).toBe(true);
    expect(
      sequencesToolsTesting.sequenceStepPositionSchema.safeParse(-1).success,
    ).toBe(false);
  });

  it('exposes every Apollo enrichment waiting state', () => {
    expect(SEQUENCE_WAITING_ON).toEqual(
      expect.arrayContaining([
        'APOLLO_ENRICHMENT_CLAIMED',
        'APOLLO_ENRICHMENT_JOINED',
        'APOLLO_ENRICHMENT',
      ]),
    );
  });

  it('stores manual email tasks without unsupported reply automation', () => {
    const manualEmail = sequencesToolsTesting.stepInputSchema.parse({
      type: 'SEND_EMAIL',
      settings: {
        executionMode: 'MANUAL',
        manualTaskTitle: 'Send a personal email',
        subject: 'Hello',
        bodyHtml: '<p>Hello</p>',
      },
    });

    expect(
      sequencesToolsTesting.normalizedStepSettings(manualEmail),
    ).toMatchObject({
      executionMode: 'MANUAL',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: false,
    });
    expect(
      sequencesToolsTesting.stepInputSchema.safeParse({
        type: 'SEND_EMAIL',
        settings: {
          executionMode: 'MANUAL',
          manualTaskTitle: 'Send a personal email',
          subject: 'Hello',
          bodyHtml: '<p>Hello</p>',
          stopOnReply: true,
        },
      }).success,
    ).toBe(false);
  });
});
