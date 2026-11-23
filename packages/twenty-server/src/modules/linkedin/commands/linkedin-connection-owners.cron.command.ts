import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { LinkedinConnectionOwnersCronJob } from 'src/modules/linkedin/jobs/linkedin-connection-owners.cron.job';

@Command({
  name: 'cron:linkedin:connection-owners',
  description: 'Refresh the members connected to each CRM person on LinkedIn',
})
export class LinkedinConnectionOwnersCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: LinkedinConnectionOwnersCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: '*/5 * * * *' },
      },
    });
  }
}
