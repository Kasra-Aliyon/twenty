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

  it('patches step copy without turning manual outreach automated or losing variants', () => {
    const patch = sequencesToolsTesting.stepUpdateInputSchema.parse({
      type: 'SEND_EMAIL',
      settings: { subject: 'Updated subject' },
    });
    const merged = sequencesToolsTesting.withPreservedStepSettings({
      currentStep: {
        settings: {
          type: 'SEND_EMAIL',
          executionMode: 'MANUAL',
          manualTaskTitle: 'Send this personally',
          manualTaskDescription: 'Use the CRM context.',
          subject: 'Original subject',
          bodyHtml: '<p>Original body</p>',
          threadAsReplyToPreviousEmail: false,
          stopOnReply: false,
        },
      },
      input: patch,
    });

    expect(merged.settings).toMatchObject({
      executionMode: 'MANUAL',
      manualTaskTitle: 'Send this personally',
      manualTaskDescription: 'Use the CRM context.',
      subject: 'Updated subject',
      bodyHtml: '<p>Original body</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: false,
    });
  });

  it('preserves email automation settings on patch and clears variants only explicitly', () => {
    const currentStep = {
      settings: {
        type: 'SEND_EMAIL',
        executionMode: 'AUTOMATED',
        manualTaskTitle: '',
        manualTaskDescription: '',
        subject: 'Original subject',
        bodyHtml: '<p>Original body</p>',
        variants: [
          {
            id: 'a',
            name: 'A',
            subject: 'A',
            bodyHtml: '<p>A</p>',
            weight: 1,
          },
          {
            id: 'b',
            name: 'B',
            subject: 'B',
            bodyHtml: '<p>B</p>',
            weight: 1,
          },
        ],
        threadAsReplyToPreviousEmail: true,
        stopOnReply: true,
      },
    };
    const copyPatch = sequencesToolsTesting.stepUpdateInputSchema.parse({
      type: 'SEND_EMAIL',
      settings: { bodyHtml: '<p>Updated</p>' },
    });

    expect(
      sequencesToolsTesting.withPreservedStepSettings({
        currentStep,
        input: copyPatch,
      }).settings,
    ).toMatchObject({
      variants: currentStep.settings.variants,
      threadAsReplyToPreviousEmail: true,
      stopOnReply: true,
    });

    const clearVariantsPatch =
      sequencesToolsTesting.stepUpdateInputSchema.parse({
        type: 'SEND_EMAIL',
        settings: { variants: null },
      });

    expect(
      sequencesToolsTesting.withPreservedStepSettings({
        currentStep,
        input: clearVariantsPatch,
      }).settings,
    ).not.toHaveProperty('variants');
  });

  it('sends a sparse atomic sequence patch so the server preserves concurrent settings', () => {
    const data = sequencesToolsTesting.mergeSequenceUpdateData({
      settings: { dailyStarts: 12 },
    });

    expect(data).toEqual({
      settings: {
        dailyStarts: 12,
        __twentySequenceSettingsAtomicPatch: true,
      },
    });
  });

  it('sends sparse same-type step patches and full validated type replacements', () => {
    const currentStep = {
      settings: {
        type: 'SEND_EMAIL',
        executionMode: 'AUTOMATED',
        manualTaskTitle: '',
        manualTaskDescription: '',
        subject: 'Original subject',
        bodyHtml: '<p>Original body</p>',
        threadAsReplyToPreviousEmail: true,
        stopOnReply: true,
      },
    };
    const sameTypePatch = sequencesToolsTesting.stepPatchData({
      currentStep,
      input: sequencesToolsTesting.stepUpdateInputSchema.parse({
        type: 'SEND_EMAIL',
        settings: { subject: 'Concurrent-safe subject' },
      }),
    });

    expect(sameTypePatch).toEqual({
      type: 'SEND_EMAIL',
      settings: {
        type: 'SEND_EMAIL',
        subject: 'Concurrent-safe subject',
        __twentySequenceSettingsAtomicPatch: true,
        __twentySequenceStepSettingsPatchBaseType: 'SEND_EMAIL',
      },
    });

    const typeChangePatch = sequencesToolsTesting.stepPatchData({
      currentStep,
      input: sequencesToolsTesting.stepUpdateInputSchema.parse({
        type: 'DELAY',
        settings: { days: 2 },
      }),
    });

    expect(typeChangePatch).toEqual({
      type: 'DELAY',
      settings: {
        type: 'DELAY',
        days: 2,
        hours: 0,
        minutes: 0,
        __twentySequenceSettingsAtomicPatch: true,
        __twentySequenceStepSettingsPatchBaseType: 'SEND_EMAIL',
      },
    });
  });

  it('marks omitted positions for a server-serialized atomic append', () => {
    const input = sequencesToolsTesting.stepInputSchema.parse({
      type: 'DELAY',
      settings: { days: 1 },
    });

    expect(
      sequencesToolsTesting.stepData({ input, atomicAppend: true }),
    ).toEqual({
      type: 'DELAY',
      settings: {
        type: 'DELAY',
        days: 1,
        hours: 0,
        minutes: 0,
        __twentySequenceStepAtomicAppend: true,
      },
    });
  });

  it('advertises point-in-time conditions and exact accepted-invite semantics', () => {
    expect(sequencesToolsTesting.sequenceCapabilities.server_version).toBe(
      '0.3.0',
    );
    expect(sequencesToolsTesting.sequenceCapabilities.contract_version).toBe(
      '2026-08-20.2',
    );
    expect(
      sequencesToolsTesting.sequenceCapabilities.placement.semantics,
    ).toContain('point-in-time');
    expect(
      sequencesToolsTesting.sequenceCapabilities.step_types.CONDITION.conditions
        .ACCEPTED_LINKEDIN_INVITE,
    ).toContain('previously sent the invitation');
  });
});
