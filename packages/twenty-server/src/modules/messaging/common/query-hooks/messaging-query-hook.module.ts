import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';
import { MessageDraftAccessService } from 'src/modules/messaging/common/query-hooks/message-draft/message-draft-access.service';
import {
  MessageDraftCreateManyPreQueryHook,
  MessageDraftCreateOnePreQueryHook,
  MessageDraftDeleteManyPreQueryHook,
  MessageDraftDeleteOnePreQueryHook,
  MessageDraftDestroyManyPreQueryHook,
  MessageDraftDestroyOnePreQueryHook,
  MessageDraftFindDuplicatesPreQueryHook,
  MessageDraftFindManyPreQueryHook,
  MessageDraftFindOnePreQueryHook,
  MessageDraftGroupByPreQueryHook,
  MessageDraftMergeManyPreQueryHook,
  MessageDraftRestoreManyPreQueryHook,
  MessageDraftRestoreOnePreQueryHook,
  MessageDraftUpdateManyPreQueryHook,
  MessageDraftUpdateOnePreQueryHook,
} from 'src/modules/messaging/common/query-hooks/message-draft/message-draft.query-hooks';
import { ApplyMessagesVisibilityRestrictionsService } from 'src/modules/messaging/common/query-hooks/message/apply-messages-visibility-restrictions.service';
import { MessageFindManyPostQueryHook } from 'src/modules/messaging/common/query-hooks/message/message-find-many.post-query.hook';
import { MessageFindOnePostQueryHook } from 'src/modules/messaging/common/query-hooks/message/message-find-one.post-query.hook';
import { MessagingImportManagerModule } from 'src/modules/messaging/message-import-manager/messaging-import-manager.module';

@Module({
  imports: [
    MessagingImportManagerModule,
    TypeOrmModule.forFeature([
      ConnectedAccountEntity,
      MessageChannelEntity,
      MessageFolderEntity,
      UserWorkspaceEntity,
    ]),
  ],
  providers: [
    ApplyMessagesVisibilityRestrictionsService,
    MessageFindOnePostQueryHook,
    MessageFindManyPostQueryHook,
    MessageDraftAccessService,
    MessageDraftFindManyPreQueryHook,
    MessageDraftFindOnePreQueryHook,
    MessageDraftFindDuplicatesPreQueryHook,
    MessageDraftGroupByPreQueryHook,
    MessageDraftCreateManyPreQueryHook,
    MessageDraftCreateOnePreQueryHook,
    MessageDraftUpdateManyPreQueryHook,
    MessageDraftUpdateOnePreQueryHook,
    MessageDraftDeleteManyPreQueryHook,
    MessageDraftDeleteOnePreQueryHook,
    MessageDraftDestroyManyPreQueryHook,
    MessageDraftDestroyOnePreQueryHook,
    MessageDraftRestoreManyPreQueryHook,
    MessageDraftRestoreOnePreQueryHook,
    MessageDraftMergeManyPreQueryHook,
  ],
})
export class MessagingQueryHookModule {}
