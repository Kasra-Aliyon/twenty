import { Logger } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { APOLLO_PHONE_ENRICHMENT_POLL_JOB_NAME } from 'src/modules/apollo-enrichment/apollo-enrichment.constants';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';
import { type ApolloEnrichmentTrigger } from 'src/modules/apollo-enrichment/types/apollo-enrichment-trigger.type';

export type ApolloEnrichPersonJobData = {
  workspaceId: string;
  personId: string;
  trigger: ApolloEnrichmentTrigger;
};

type ApolloPhoneEnrichmentPollJobData = {
  matchFingerprint: string;
  personId: string;
  requestId: string;
  requestToken: string;
  workspaceId: string;
};

@Processor(MessageQueue.apolloEnrichmentQueue)
export class ApolloEnrichPersonJob {
  private readonly logger = new Logger(ApolloEnrichPersonJob.name);

  constructor(
    private readonly apolloEnrichmentService: ApolloEnrichmentService,
  ) {}

  @Process(ApolloEnrichPersonJob.name)
  async handle(data: ApolloEnrichPersonJobData): Promise<void> {
    try {
      const result = await this.apolloEnrichmentService.enrichPerson({
        workspaceId: data.workspaceId,
        personId: data.personId,
      });

      this.logger.log(
        `Apollo enrichment ${result} for person ${data.personId} in workspace ${data.workspaceId} from ${data.trigger}`,
      );
    } catch (error) {
      if (error instanceof ApolloEnrichmentError && !error.retryable) {
        this.logger.warn(
          `Apollo enrichment skipped after non-retryable error for person ${data.personId} in workspace ${data.workspaceId}: ${error.message}`,
        );

        return;
      }

      throw error;
    }
  }

  @Process(APOLLO_PHONE_ENRICHMENT_POLL_JOB_NAME)
  async handlePhoneEnrichmentPoll(
    data: ApolloPhoneEnrichmentPollJobData,
  ): Promise<void> {
    const result = await this.apolloEnrichmentService.pollPhoneEnrichment(data);

    if (result === 'pending') {
      throw new ApolloEnrichmentError(
        'Apollo phone enrichment result is still pending',
        true,
        404,
      );
    }
  }
}
