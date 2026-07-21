import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  SEQUENCE_STEP_TYPES,
  type SequenceEmailStepSettings,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { EmailComposerService } from 'src/engine/core-modules/tool/tools/email-tool/email-composer.service';
import { SendEmailService } from 'src/modules/messaging/message-outbound-manager/services/send-email.service';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import {
  type SequenceEnrollmentWorkspaceEntity,
  type SequenceSentEmailMetadata,
} from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { renderSequenceTemplate } from 'src/modules/sequence/utils/render-sequence-template.util';

export type SequenceEmailSendResult = {
  headerMessageId: string;
  threadExternalId: string;
};

@Injectable()
export class SequenceEmailSenderService {
  constructor(
    private readonly emailComposerService: EmailComposerService,
    private readonly sendEmailService: SendEmailService,
    private readonly sequenceVariableService: SequenceVariableService,
  ) {}

  async send({
    workspaceId,
    enrollment,
    person,
    step,
    steps,
    settings,
    connectedAccountId,
  }: {
    workspaceId: string;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    steps: SequenceStepWorkspaceEntity[];
    settings: SequenceEmailStepSettings;
    connectedAccountId: string;
  }): Promise<SequenceEmailSendResult> {
    const variables = await this.sequenceVariableService.buildVariables({
      workspaceId,
      person,
      connectedAccountId,
    });
    const subject = renderSequenceTemplate(settings.subject, variables, {
      escapeValues: false,
    });
    const body = renderSequenceTemplate(settings.bodyHtml, variables, {
      escapeValues: true,
    });
    const inReplyTo = settings.threadAsReplyToPreviousEmail
      ? this.findPreviousEmailHeaderMessageId({
          currentStep: step,
          steps,
          sentEmailsByStepId: enrollment.sentEmailsByStepId ?? {},
        })
      : undefined;
    const composeResult = await this.emailComposerService.composeEmail(
      {
        recipients: {
          to: person.emails.primaryEmail,
        },
        subject,
        body,
        connectedAccountId,
        files: [],
        inReplyTo,
      },
      { workspaceId },
    );

    if (!composeResult.success) {
      throw new Error(
        composeResult.output.error ??
          composeResult.output.message ??
          'Failed to compose sequence email',
      );
    }

    const sendResult = await this.sendEmailService.sendComposedEmail(
      composeResult.data,
    );

    if (composeResult.data.shouldPersistMessage) {
      await this.sendEmailService.persistSentMessage(
        sendResult,
        composeResult.data,
        workspaceId,
      );
    }

    return {
      headerMessageId: sendResult.headerMessageId,
      threadExternalId:
        sendResult.threadExternalId ?? sendResult.headerMessageId,
    };
  }

  private findPreviousEmailHeaderMessageId({
    currentStep,
    steps,
    sentEmailsByStepId,
  }: {
    currentStep: SequenceStepWorkspaceEntity;
    steps: SequenceStepWorkspaceEntity[];
    sentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
  }): string | undefined {
    const previousEmailSteps = steps
      .filter(
        (step) =>
          step.position < currentStep.position &&
          step.type === SEQUENCE_STEP_TYPES.SEND_EMAIL,
      )
      .sort((left, right) => right.position - left.position);

    for (const previousStep of previousEmailSteps) {
      const headerMessageId =
        sentEmailsByStepId[previousStep.id]?.headerMessageId;

      if (isDefined(headerMessageId) && isNonEmptyString(headerMessageId)) {
        return headerMessageId;
      }
    }

    return undefined;
  }
}
