import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import {
  SequenceCreateManyPreQueryHook,
  SequenceCreateOnePreQueryHook,
  SequenceDeleteManyPreQueryHook,
  SequenceDeleteOnePreQueryHook,
  SequenceDestroyManyPreQueryHook,
  SequenceDestroyOnePreQueryHook,
  SequenceMergeManyPreQueryHook,
  SequenceRestoreManyPreQueryHook,
  SequenceRestoreOnePreQueryHook,
  SequenceUpdateManyPreQueryHook,
  SequenceUpdateOnePreQueryHook,
} from 'src/modules/sequence/query-hooks/sequence.query-hooks';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectedAccountEntity,
      MessageChannelEntity,
      UserWorkspaceEntity,
    ]),
    WorkspaceDataSourceModule,
  ],
  providers: [
    SequenceInvariantService,
    SequenceSenderService,
    SequenceCreateOnePreQueryHook,
    SequenceCreateManyPreQueryHook,
    SequenceUpdateOnePreQueryHook,
    SequenceUpdateManyPreQueryHook,
    SequenceDeleteOnePreQueryHook,
    SequenceDeleteManyPreQueryHook,
    SequenceDestroyOnePreQueryHook,
    SequenceDestroyManyPreQueryHook,
    SequenceRestoreOnePreQueryHook,
    SequenceRestoreManyPreQueryHook,
    SequenceMergeManyPreQueryHook,
  ],
})
export class SequenceQueryHookModule {}
