import { Injectable } from '@nestjs/common';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  SequenceProcessEnrollmentJob,
  type SequenceProcessEnrollmentJobData,
} from 'src/modules/sequence/jobs/sequence-process-enrollment.job';
import { SEQUENCE_PROCESS_JOB_ID_PREFIX } from 'src/modules/sequence/sequence.constants';

@Injectable()
export class SequenceQueueService {
  constructor(
    @InjectMessageQueue(MessageQueue.sequenceQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async enqueueProcess({
    workspaceId,
    enrollmentId,
  }: SequenceProcessEnrollmentJobData): Promise<void> {
    await this.messageQueueService.add<SequenceProcessEnrollmentJobData>(
      SequenceProcessEnrollmentJob.name,
      { workspaceId, enrollmentId },
      {
        id: `${SEQUENCE_PROCESS_JOB_ID_PREFIX}:${workspaceId}:${enrollmentId}`,
        retryLimit: 1,
      },
    );
  }
}
