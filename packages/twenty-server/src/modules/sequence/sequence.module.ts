import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { ApolloEnrichmentModule } from 'src/modules/apollo-enrichment/apollo-enrichment.module';
import { MessagingSendManagerModule } from 'src/modules/messaging/message-outbound-manager/messaging-send-manager.module';
import { SequenceTickCronCommand } from 'src/modules/sequence/crons/commands/sequence-tick.cron.command';
import { SequenceTickCronJob } from 'src/modules/sequence/crons/jobs/sequence-tick.cron.job';
import { SequenceProcessEnrollmentJob } from 'src/modules/sequence/jobs/sequence-process-enrollment.job';
import { SequenceEnrollmentListener } from 'src/modules/sequence/listeners/sequence-enrollment.listener';
import { SequenceLinkedinActionListener } from 'src/modules/sequence/listeners/sequence-linkedin-action.listener';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { SequenceTaskListener } from 'src/modules/sequence/listeners/sequence-task.listener';
import { SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import { SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';

@Module({
  imports: [
    ApolloEnrichmentModule,
    FeatureFlagModule,
    MessagingSendManagerModule,
    ToolModule,
    WorkspaceDataSourceModule,
    TypeOrmModule.forFeature([
      ConnectedAccountEntity,
      MessageChannelEntity,
      UserWorkspaceEntity,
      WorkspaceEntity,
    ]),
  ],
  providers: [
    SequenceEmailSenderService,
    SequenceEnrollmentListener,
    SequenceExecutorService,
    SequenceLinkedinActionListener,
    SequenceLinkedinReplyListener,
    SequenceLinkedinThrottleService,
    SequenceMailboxThrottleService,
    SequenceMetricsService,
    SequenceProcessEnrollmentJob,
    SequenceQueueService,
    SequenceReplyListener,
    SequenceSchedulerService,
    SequenceSenderService,
    SequenceTaskCreatorService,
    SequenceTaskCompletionService,
    SequenceTaskListener,
    SequenceTickCronCommand,
    SequenceTickCronJob,
    SequenceVariableService,
  ],
  exports: [SequenceTickCronCommand],
})
export class SequenceModule {}
