import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type SequenceEmailStepSettings } from 'twenty-shared/types';
import { isDefined, renderSpintax } from 'twenty-shared/utils';

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
import { selectSequenceEmailVariant } from 'src/modules/sequence/utils/select-sequence-email-variant.util';

export type SequenceEmailSendResult = {
  headerMessageId: string;
  threadExternalId: string;
  sentAt: string;
  variantId?: string;
  variantName?: string;
  persistSentMessage: () => Promise<void>;
};

export class SequenceEmailPreparationPermanentError extends Error {}

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
    settings,
    connectedAccountId,
    onProviderStart,
  }: {
    workspaceId: string;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceEmailStepSettings;
    connectedAccountId: string;
    onProviderStart: () => Promise<void>;
  }): Promise<SequenceEmailSendResult> {
    const variables = await this.sequenceVariableService.buildVariables({
      workspaceId,
      person,
      connectedAccountId,
    });
    const selectedVariant = selectSequenceEmailVariant({
      enrollmentId: enrollment.id,
      stepId: step.id,
      variants: settings.variants,
    });
    const spintaxSeed = `${enrollment.id}:${step.id}:${selectedVariant?.id ?? 'control'}`;
    const subject = renderSequenceTemplate(
      renderSpintax(
        selectedVariant?.subject ?? settings.subject,
        `${spintaxSeed}:subject`,
      ),
      variables,
      {
        escapeValues: false,
      },
    );
    const body = renderSequenceTemplate(
      renderSpintax(
        selectedVariant?.bodyHtml ?? settings.bodyHtml,
        `${spintaxSeed}:body`,
      ),
      variables,
      {
        escapeValues: true,
      },
    );
    const inReplyTo = settings.threadAsReplyToPreviousEmail
      ? this.findPreviousEmailHeaderMessageId({
          currentStepId: step.id,
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
      throw new SequenceEmailPreparationPermanentError(
        composeResult.output.error ??
          composeResult.output.message ??
          'Failed to compose sequence email',
      );
    }

    let providerStartedAt: string | undefined;
    const sendResult = await this.sendEmailService.sendComposedEmail(
      composeResult.data,
      async () => {
        providerStartedAt = new Date().toISOString();
        await onProviderStart();
      },
    );
    const sentAt =
      sendResult.sentAt ?? providerStartedAt ?? new Date().toISOString();

    return {
      headerMessageId: sendResult.headerMessageId,
      threadExternalId:
        sendResult.threadExternalId ?? sendResult.headerMessageId,
      sentAt,
      ...(isDefined(selectedVariant)
        ? {
            variantId: selectedVariant.id,
            variantName: selectedVariant.name,
          }
        : {}),
      persistSentMessage: async () => {
        if (!composeResult.data.shouldPersistMessage) {
          return;
        }

        await this.sendEmailService.persistSentMessage(
          sendResult,
          composeResult.data,
          workspaceId,
        );
      },
    };
  }

  // The thread to continue is the last email this enrollment actually sent,
  // read from its own send history. Step position cannot answer this: a branch
  // step is positioned after the step it merges into whenever the branch was
  // filled in after the merge, and a position-ordered search then finds no
  // previous email at all and silently starts a new thread.
  private findPreviousEmailHeaderMessageId({
    currentStepId,
    sentEmailsByStepId,
  }: {
    currentStepId: string;
    sentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
  }): string | undefined {
    return Object.entries(sentEmailsByStepId)
      .filter(
        ([stepId, sentEmail]) =>
          stepId !== currentStepId &&
          isDefined(sentEmail?.headerMessageId) &&
          isNonEmptyString(sentEmail.headerMessageId),
      )
      .sort(
        ([, left], [, right]) =>
          this.toTimestamp(right.sentAt) - this.toTimestamp(left.sentAt),
      )[0]?.[1].headerMessageId;
  }

  private toTimestamp(value: string | undefined): number {
    const timestamp = Date.parse(value ?? '');

    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
