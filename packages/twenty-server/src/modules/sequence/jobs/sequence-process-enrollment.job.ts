import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';

export type SequenceProcessEnrollmentJobData = {
  workspaceId: string;
  enrollmentId: string;
};

@Processor(MessageQueue.sequenceQueue)
export class SequenceProcessEnrollmentJob {
  constructor(
    private readonly sequenceExecutorService: SequenceExecutorService,
  ) {}

  @Process(SequenceProcessEnrollmentJob.name)
  async handle(data: SequenceProcessEnrollmentJobData): Promise<void> {
    await this.sequenceExecutorService.process(data);
  }
}
