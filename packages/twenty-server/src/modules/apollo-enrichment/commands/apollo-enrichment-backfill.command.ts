import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Command, CommandRunner, Option } from 'nest-commander';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { ApolloEnrichmentQueueService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-queue.service';

type ApolloEnrichmentBackfillCommandOptions = {
  workspaceId?: string;
  limit?: number;
  dryRun?: boolean;
};

@Command({
  name: 'apollo:enrichment:backfill',
  description: 'Enqueue Apollo enrichment jobs for recent people with gaps',
})
export class ApolloEnrichmentBackfillCommand extends CommandRunner {
  private readonly logger = new Logger(ApolloEnrichmentBackfillCommand.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly apolloEnrichmentService: ApolloEnrichmentService,
    private readonly apolloEnrichmentQueueService: ApolloEnrichmentQueueService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {
    super();
  }

  async run(
    _passedParams: string[],
    options: ApolloEnrichmentBackfillCommandOptions,
  ): Promise<void> {
    const limit =
      options.limit ??
      this.twentyConfigService.get('APOLLO_ENRICHMENT_BACKFILL_LIMIT');
    const workspaces = await this.getWorkspaces(options.workspaceId);

    for (const workspace of workspaces) {
      const personIds =
        await this.apolloEnrichmentService.findBackfillCandidatePersonIds({
          workspaceId: workspace.id,
          limit,
          requireBackfillEnabled: false,
        });

      if (options.dryRun) {
        this.logger.log(
          `Apollo enrichment backfill dry run for workspace ${workspace.id}: ${personIds.length} candidate(s)`,
        );
        this.logger.log(personIds.join('\n'));
        continue;
      }

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

      this.logger.log(
        `Enqueued ${personIds.length} Apollo enrichment backfill job(s) for workspace ${workspace.id}`,
      );
    }
  }

  @Option({
    flags: '-w, --workspace-id [workspace_id]',
    description: 'Workspace ID. If omitted, all active workspaces are scanned.',
    required: false,
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Maximum number of people to enqueue per workspace.',
    required: false,
  })
  parseLimit(value: string): number {
    const parsedLimit = Number.parseInt(value, 10);

    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      throw new Error('--limit must be a positive integer');
    }

    return parsedLimit;
  }

  @Option({
    flags: '--dry-run',
    description: 'List candidates without enqueueing jobs.',
    required: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  private async getWorkspaces(
    workspaceId: string | undefined,
  ): Promise<Pick<WorkspaceEntity, 'id'>[]> {
    if (workspaceId) {
      return [{ id: workspaceId }];
    }

    return this.workspaceRepository.find({
      where: {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      },
      select: ['id'],
    });
  }
}
