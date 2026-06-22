import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  APOLLO_ENRICHMENT_BACKFILL_DEFAULT_CRON_PATTERN,
  ApolloEnrichmentBackfillCronJob,
} from 'src/modules/apollo-enrichment/crons/jobs/apollo-enrichment-backfill.cron.job';

@Command({
  name: 'cron:apollo:enrichment:backfill',
  description: 'Starts the Apollo enrichment backfill cron job',
})
export class ApolloEnrichmentBackfillCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: ApolloEnrichmentBackfillCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern:
            this.twentyConfigService.get(
              'APOLLO_ENRICHMENT_BACKFILL_CRON_PATTERN',
            ) ?? APOLLO_ENRICHMENT_BACKFILL_DEFAULT_CRON_PATTERN,
        },
      },
    });
  }
}
