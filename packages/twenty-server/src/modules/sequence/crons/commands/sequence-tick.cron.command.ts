import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  SEQUENCE_TICK_DEFAULT_CRON_PATTERN,
  SequenceTickCronJob,
} from 'src/modules/sequence/crons/jobs/sequence-tick.cron.job';

@Command({
  name: 'cron:sequence:tick',
  description: 'Starts the outreach sequence scheduler cron job',
})
export class SequenceTickCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: SequenceTickCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: SEQUENCE_TICK_DEFAULT_CRON_PATTERN },
      },
    });
  }
}
