import { Injectable } from '@nestjs/common';

import {
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';
import { MoreThanOrEqual } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

@Injectable()
export class SequenceEmailReplyReconciliationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceReplyListener: SequenceReplyListener,
  ) {}

  async reconcileBeforeEnrollmentProgress({
    workspaceId,
    enrollment,
    enrollmentRepository,
  }: {
    workspaceId: string;
    enrollment: Pick<
      SequenceEnrollmentWorkspaceEntity,
      'id' | 'personId' | 'sentEmailsByStepId'
    >;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<boolean> {
    const earliestSentAtTimestamp = Object.values(
      enrollment.sentEmailsByStepId ?? {},
    ).reduce((earliestTimestamp, sentEmail) => {
      const sentAtTimestamp = Date.parse(sentEmail.sentAt);

      return Number.isNaN(sentAtTimestamp)
        ? earliestTimestamp
        : Math.min(earliestTimestamp, sentAtTimestamp);
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(earliestSentAtTimestamp)) {
      return false;
    }

    const messageParticipantRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        MessageParticipantWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const participants = await messageParticipantRepository.find({
      where: {
        personId: enrollment.personId,
        role: MessageParticipantRole.FROM,
        createdAt: MoreThanOrEqual(
          new Date(earliestSentAtTimestamp).toISOString(),
        ),
      },
      select: [
        'createdAt',
        'id',
        'messageId',
        'personId',
        'role',
        'workspaceMemberId',
      ],
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    if (participants.length === 0) {
      return false;
    }

    await this.sequenceReplyListener.reconcileMessageParticipants({
      workspaceId,
      participants,
      sequenceEnrollmentId: enrollment.id,
    });

    const reconciledEnrollment = await enrollmentRepository.findOne({
      where: { id: enrollment.id },
      select: ['id', 'status'],
    });

    return (
      reconciledEnrollment?.status === SEQUENCE_ENROLLMENT_STATUSES.REPLIED
    );
  }
}
