import {
  SEQUENCE_STEP_TYPES,
  type SequenceEmailStepSettings,
  type SequenceEmailVariant,
} from 'twenty-shared/types';

import { type EmailComposerService } from 'src/engine/core-modules/tool/tools/email-tool/email-composer.service';
import { type SendEmailService } from 'src/modules/messaging/message-outbound-manager/services/send-email.service';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import {
  SequenceEmailPreparationPermanentError,
  SequenceEmailSenderService,
} from 'src/modules/sequence/services/sequence-email-sender.service';
import { type SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { selectSequenceEmailVariant } from 'src/modules/sequence/utils/select-sequence-email-variant.util';

const variants: SequenceEmailVariant[] = [
  {
    id: 'variant-a',
    name: 'A',
    subject: 'A for {{firstName}}',
    bodyHtml: '<p>A for {{firstName}}</p>',
    weight: 50,
  },
  {
    id: 'variant-b',
    name: 'B',
    subject: 'B for {{firstName}}',
    bodyHtml: '<p>B for {{firstName}}</p>',
    weight: 50,
  },
];

const settings: SequenceEmailStepSettings = {
  type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
  subject: 'Legacy subject',
  bodyHtml: '<p>Legacy body</p>',
  variants,
  threadAsReplyToPreviousEmail: false,
  stopOnReply: null,
};

describe('SequenceEmailSenderService', () => {
  const setup = () => {
    const composeEmail = jest.fn().mockResolvedValue({
      success: true,
      data: { shouldPersistMessage: false },
      output: {},
    });
    const sendComposedEmail = jest.fn(
      async (_data: unknown, onProviderStart?: () => Promise<void>) => {
        await onProviderStart?.();

        return {
          headerMessageId: 'header-message-id',
          threadExternalId: 'thread-external-id',
        };
      },
    );
    const persistSentMessage = jest.fn();
    const buildVariables = jest.fn().mockResolvedValue({ firstName: 'Ada' });
    const onProviderStart = jest.fn().mockResolvedValue(undefined);
    const service = new SequenceEmailSenderService(
      { composeEmail } as unknown as EmailComposerService,
      {
        sendComposedEmail,
        persistSentMessage,
      } as unknown as SendEmailService,
      { buildVariables } as unknown as SequenceVariableService,
    );
    const enrollment = {
      id: 'enrollment-id',
      sentEmailsByStepId: {},
    } as SequenceEnrollmentWorkspaceEntity;
    const step = {
      id: 'step-id',
      position: 0,
      settings,
    } as SequenceStepWorkspaceEntity;
    const person = {
      emails: { primaryEmail: 'ada@example.com' },
    } as PersonWorkspaceEntity;

    return {
      buildVariables,
      composeEmail,
      enrollment,
      person,
      onProviderStart,
      persistSentMessage,
      sendComposedEmail,
      service,
      step,
    };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders and returns the deterministic variant attribution', async () => {
    const { composeEmail, enrollment, onProviderStart, person, service, step } =
      setup();
    const selectedVariant = selectSequenceEmailVariant({
      enrollmentId: enrollment.id,
      stepId: step.id,
      variants,
    });

    const result = await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(composeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: selectedVariant?.subject.replace('{{firstName}}', 'Ada'),
        body: selectedVariant?.bodyHtml.replace('{{firstName}}', 'Ada'),
      }),
      { workspaceId: 'workspace-id' },
    );
    expect(result).toEqual({
      headerMessageId: 'header-message-id',
      threadExternalId: 'thread-external-id',
      sentAt: expect.any(String),
      variantId: selectedVariant?.id,
      variantName: selectedVariant?.name,
      persistSentMessage: expect.any(Function),
    });
    expect(onProviderStart).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy email steps un-attributed', async () => {
    const { composeEmail, enrollment, onProviderStart, person, service, step } =
      setup();
    const legacySettings = { ...settings, variants: undefined };

    const result = await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings: legacySettings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(composeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Legacy subject',
        body: '<p>Legacy body</p>',
      }),
      { workspaceId: 'workspace-id' },
    );
    expect(result).toEqual({
      headerMessageId: 'header-message-id',
      threadExternalId: 'thread-external-id',
      sentAt: expect.any(String),
      persistSentMessage: expect.any(Function),
    });
  });

  it('records sentAt immediately before provider delivery', async () => {
    const providerStartedAt = new Date('2026-08-17T10:00:00.000Z');

    jest.useFakeTimers({ now: providerStartedAt });

    const {
      enrollment,
      onProviderStart,
      person,
      sendComposedEmail,
      service,
      step,
    } = setup();

    sendComposedEmail.mockImplementation(async (_data, startProvider) => {
      await startProvider?.();
      jest.setSystemTime(new Date('2026-08-17T10:00:10.000Z'));

      return {
        headerMessageId: 'header-message-id',
        threadExternalId: 'thread-external-id',
      };
    });

    const result = await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(result.sentAt).toBe(providerStartedAt.toISOString());
  });

  it('marks provider start after preparation and defers sent-message persistence', async () => {
    const {
      composeEmail,
      enrollment,
      onProviderStart,
      persistSentMessage,
      person,
      sendComposedEmail,
      service,
      step,
    } = setup();

    composeEmail.mockResolvedValueOnce({
      success: true,
      data: { shouldPersistMessage: true },
      output: {},
    });

    const result = await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(composeEmail.mock.invocationCallOrder[0]).toBeLessThan(
      sendComposedEmail.mock.invocationCallOrder[0],
    );
    expect(sendComposedEmail.mock.invocationCallOrder[0]).toBeLessThan(
      onProviderStart.mock.invocationCallOrder[0],
    );
    expect(persistSentMessage).not.toHaveBeenCalled();

    await result.persistSentMessage();

    expect(persistSentMessage).toHaveBeenCalledTimes(1);
  });

  it('classifies composer validation failures before provider start as permanent', async () => {
    const {
      composeEmail,
      enrollment,
      onProviderStart,
      person,
      sendComposedEmail,
      service,
      step,
    } = setup();

    composeEmail.mockResolvedValueOnce({
      success: false,
      output: {
        success: false,
        error: 'Invalid email addresses: invalid-address',
      },
    });

    await expect(
      service.send({
        workspaceId: 'workspace-id',
        enrollment,
        person,
        step,
        settings,
        connectedAccountId: 'connected-account-id',
        onProviderStart,
      }),
    ).rejects.toBeInstanceOf(SequenceEmailPreparationPermanentError);

    expect(onProviderStart).not.toHaveBeenCalled();
    expect(sendComposedEmail).not.toHaveBeenCalled();
  });

  it('renders spintax before inserting recipient variables', async () => {
    const {
      buildVariables,
      composeEmail,
      enrollment,
      onProviderStart,
      person,
      service,
      step,
    } = setup();
    const spintaxSettings = {
      ...settings,
      variants: undefined,
      subject: '{Hi|Hello} {{firstName}}',
      bodyHtml: '<p>{Quick|Short} note for {{firstName}}</p>',
    };

    buildVariables.mockResolvedValue({ firstName: '{Ada|Grace}' });

    await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings: spintaxSettings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    const firstComposeInput = composeEmail.mock.calls[0][0];

    await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings: spintaxSettings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(composeEmail.mock.calls[1][0]).toEqual(firstComposeInput);
    expect(firstComposeInput.subject).toMatch(/^(Hi|Hello) \{Ada\|Grace\}$/);
    expect(firstComposeInput.body).toMatch(
      /^<p>(Quick|Short) note for \{Ada\|Grace\}<\/p>$/,
    );
  });

  it('continues the thread of the last email actually sent, across a branch', async () => {
    const { composeEmail, onProviderStart, person, service } = setup();
    // Built in the order the builder encourages: the condition, the step both
    // outcomes merge into, and only then the branch content. Positions are
    // handed out globally, so the branch email sits after the merge email.
    const conditionStep = {
      id: 'condition-step-id',
      position: 0,
      settings: { type: SEQUENCE_STEP_TYPES.CONDITION },
    } as unknown as SequenceStepWorkspaceEntity;
    const mergeEmailSettings: SequenceEmailStepSettings = {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Follow up',
      bodyHtml: '<p>Follow up</p>',
      threadAsReplyToPreviousEmail: true,
      stopOnReply: null,
    };
    const mergeEmailStep = {
      id: 'merge-email-step-id',
      position: 1,
      settings: mergeEmailSettings,
    } as SequenceStepWorkspaceEntity;
    const branchEmailStep = {
      id: 'branch-email-step-id',
      position: 2,
      settings: {
        ...mergeEmailSettings,
        branch: { conditionStepId: conditionStep.id, outcome: 'YES' },
      },
    } as unknown as SequenceStepWorkspaceEntity;
    const enrollment = {
      id: 'enrollment-id',
      sentEmailsByStepId: {
        [branchEmailStep.id]: {
          headerMessageId: 'branch-header-message-id',
          threadExternalId: 'branch-thread-id',
          sentAt: '2026-07-21T09:00:00.000Z',
        },
      },
    } as unknown as SequenceEnrollmentWorkspaceEntity;

    await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step: mergeEmailStep,
      settings: mergeEmailSettings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(composeEmail.mock.calls[0][0].inReplyTo).toBe(
      'branch-header-message-id',
    );
  });

  it('starts a new thread when nothing has been sent yet', async () => {
    const { composeEmail, enrollment, onProviderStart, person, service, step } =
      setup();
    const threadedSettings: SequenceEmailStepSettings = {
      ...settings,
      variants: undefined,
      threadAsReplyToPreviousEmail: true,
    };

    await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      settings: threadedSettings,
      connectedAccountId: 'connected-account-id',
      onProviderStart,
    });

    expect(composeEmail.mock.calls[0][0].inReplyTo).toBeUndefined();
  });
});
