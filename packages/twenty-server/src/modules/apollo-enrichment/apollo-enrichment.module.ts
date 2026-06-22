import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { ApolloEnrichmentBackfillCommand } from 'src/modules/apollo-enrichment/commands/apollo-enrichment-backfill.command';
import { ApolloEnrichmentBackfillCronCommand } from 'src/modules/apollo-enrichment/crons/commands/apollo-enrichment-backfill.cron.command';
import { ApolloEnrichmentBackfillCronJob } from 'src/modules/apollo-enrichment/crons/jobs/apollo-enrichment-backfill.cron.job';
import { ApolloEnrichPersonJob } from 'src/modules/apollo-enrichment/jobs/apollo-enrich-person.job';
import { ApolloEnrichmentPersonListener } from 'src/modules/apollo-enrichment/listeners/apollo-enrichment-person.listener';
import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';
import { ApolloEnrichmentMapperService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { ApolloEnrichmentQueueService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-queue.service';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';

@Module({
  imports: [
    SecureHttpClientModule,
    TwentyConfigModule,
    WorkspaceDataSourceModule,
    TypeOrmModule.forFeature([WorkspaceEntity]),
  ],
  providers: [
    ApolloClientService,
    ApolloEnrichmentService,
    ApolloEnrichmentMapperService,
    ApolloEnrichmentQueueService,
    ApolloEnrichmentPersonListener,
    ApolloEnrichPersonJob,
    ApolloEnrichmentBackfillCronJob,
    ApolloEnrichmentBackfillCronCommand,
    ApolloEnrichmentBackfillCommand,
  ],
  exports: [
    ApolloEnrichmentBackfillCronCommand,
    ApolloEnrichmentBackfillCommand,
  ],
})
export class ApolloEnrichmentModule {}
