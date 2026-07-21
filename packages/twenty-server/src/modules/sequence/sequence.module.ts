import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { MessagingSendManagerModule } from 'src/modules/messaging/message-outbound-manager/messaging-send-manager.module';
import { SequenceTickCronCommand } from 'src/modules/sequence/crons/commands/sequence-tick.cron.command';
import { SequenceTickCronJob } from 'src/modules/sequence/crons/jobs/sequence-tick.cron.job';
import { SequenceProcessEnrollmentJob } from 'src/modules/sequence/jobs/sequence-process-enrollment.job';
import { SequenceEnrollmentListener } from 'src/modules/sequence/listeners/sequence-enrollment.listener';
import { SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { SequenceTaskListener } from 'src/modules/sequence/listeners/sequence-task.listener';
import { SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';

@Module({
  imports: [
    FeatureFlagModule,
    MessagingSendManagerModule,
    ToolModule,
    WorkspaceDataSourceModule,
    TypeOrmModule.forFeature([ConnectedAccountEntity, WorkspaceEntity]),
  ],
  providers: [
    SequenceEmailSenderService,
    SequenceEnrollmentListener,
    SequenceExecutorService,
    SequenceMailboxThrottleService,
    SequenceMetricsService,
    SequenceProcessEnrollmentJob,
    SequenceQueueService,
    SequenceReplyListener,
    SequenceSchedulerService,
    SequenceTaskCreatorService,
    SequenceTaskListener,
    SequenceTickCronCommand,
    SequenceTickCronJob,
    SequenceVariableService,
  ],
  exports: [SequenceTickCronCommand],
})
export class SequenceModule {}
