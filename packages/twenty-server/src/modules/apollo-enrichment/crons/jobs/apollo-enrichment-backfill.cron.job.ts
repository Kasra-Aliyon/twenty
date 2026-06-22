import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { ApolloEnrichmentQueueService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-queue.service';

export const APOLLO_ENRICHMENT_BACKFILL_DEFAULT_CRON_PATTERN = '*/10 * * * *';

@Processor(MessageQueue.cronQueue)
export class ApolloEnrichmentBackfillCronJob {
  private readonly logger = new Logger(ApolloEnrichmentBackfillCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly apolloEnrichmentService: ApolloEnrichmentService,
    private readonly apolloEnrichmentQueueService: ApolloEnrichmentQueueService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  @Process(ApolloEnrichmentBackfillCronJob.name)
  async handle(): Promise<void> {
    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_ENABLED')) {
      return;
    }

    if (!this.twentyConfigService.get('APOLLO_ENRICHMENT_BACKFILL_ENABLED')) {
      return;
    }

    const activeWorkspaces = await this.workspaceRepository.find({
      where: {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      },
      select: ['id'],
    });
    const limit = this.twentyConfigService.get(
      'APOLLO_ENRICHMENT_BACKFILL_LIMIT',
    );

    for (const workspace of activeWorkspaces) {
      try {
        const personIds =
          await this.apolloEnrichmentService.findBackfillCandidatePersonIds({
            workspaceId: workspace.id,
            limit,
          });

        for (const personId of personIds) {
          await this.apolloEnrichmentQueueService.enqueuePerson({
            workspaceId: workspace.id,
            personId,
            trigger: 'backfill',
          });
          this.apolloEnrichmentService.markBackfillAttempted({
            workspaceId: workspace.id,
            personId,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to enqueue Apollo enrichment backfill for workspace ${workspace.id}`,
          error,
        );
      }
    }
  }
}
