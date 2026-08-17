import {
  SEQUENCE_STEP_TYPES,
  type SequenceEmailStepSettings,
  type SequenceEmailVariant,
} from 'twenty-shared/types';

import { type EmailComposerService } from 'src/engine/core-modules/tool/tools/email-tool/email-composer.service';
import { type SendEmailService } from 'src/modules/messaging/message-outbound-manager/services/send-email.service';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
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
    const sendComposedEmail = jest.fn().mockResolvedValue({
      headerMessageId: 'header-message-id',
      threadExternalId: 'thread-external-id',
    });
    const persistSentMessage = jest.fn();
    const buildVariables = jest.fn().mockResolvedValue({ firstName: 'Ada' });
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
      service,
      step,
    };
  };

  it('renders and returns the deterministic variant attribution', async () => {
    const { composeEmail, enrollment, person, service, step } = setup();
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
      steps: [step],
      settings,
      connectedAccountId: 'connected-account-id',
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
      variantId: selectedVariant?.id,
      variantName: selectedVariant?.name,
    });
  });

  it('keeps legacy email steps un-attributed', async () => {
    const { composeEmail, enrollment, person, service, step } = setup();
    const legacySettings = { ...settings, variants: undefined };

    const result = await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      steps: [step],
      settings: legacySettings,
      connectedAccountId: 'connected-account-id',
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
    });
  });

  it('renders spintax before inserting recipient variables', async () => {
    const { buildVariables, composeEmail, enrollment, person, service, step } =
      setup();
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
      steps: [step],
      settings: spintaxSettings,
      connectedAccountId: 'connected-account-id',
    });

    const firstComposeInput = composeEmail.mock.calls[0][0];

    await service.send({
      workspaceId: 'workspace-id',
      enrollment,
      person,
      step,
      steps: [step],
      settings: spintaxSettings,
      connectedAccountId: 'connected-account-id',
    });

    expect(composeEmail.mock.calls[1][0]).toEqual(firstComposeInput);
    expect(firstComposeInput.subject).toMatch(/^(Hi|Hello) \{Ada\|Grace\}$/);
    expect(firstComposeInput.body).toMatch(
      /^<p>(Quick|Short) note for \{Ada\|Grace\}<\/p>$/,
    );
  });
});
