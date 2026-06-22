import { Injectable } from '@nestjs/common';

import {
  APOLLO_ENRICHMENT_JOB_BACKOFF_DELAY_MS,
  APOLLO_ENRICHMENT_JOB_RETRY_LIMIT,
  APOLLO_ENRICHMENT_QUEUE_JOB_ID_PREFIX,
} from 'src/modules/apollo-enrichment/apollo-enrichment.constants';
import {
  ApolloEnrichPersonJob,
  type ApolloEnrichPersonJobData,
} from 'src/modules/apollo-enrichment/jobs/apollo-enrich-person.job';
import { type ApolloEnrichmentTrigger } from 'src/modules/apollo-enrichment/types/apollo-enrichment-trigger.type';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

@Injectable()
export class ApolloEnrichmentQueueService {
  constructor(
    @InjectMessageQueue(MessageQueue.apolloEnrichmentQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async enqueuePerson({
    workspaceId,
    personId,
    trigger,
  }: {
    workspaceId: string;
    personId: string;
    trigger: ApolloEnrichmentTrigger;
  }): Promise<void> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return;
    }

    await this.messageQueueService.add<ApolloEnrichPersonJobData>(
      ApolloEnrichPersonJob.name,
      {
        workspaceId,
        personId,
        trigger,
      },
      {
        id: this.buildJobId({ workspaceId, personId }),
        retryLimit: APOLLO_ENRICHMENT_JOB_RETRY_LIMIT,
        backoff: {
          type: 'exponential',
          delay: APOLLO_ENRICHMENT_JOB_BACKOFF_DELAY_MS,
        },
      },
    );
  }

  private buildJobId({
    workspaceId,
    personId,
  }: {
    workspaceId: string;
    personId: string;
  }): string {
    return `${APOLLO_ENRICHMENT_QUEUE_JOB_ID_PREFIX}:${workspaceId}:${personId}`;
  }
}
