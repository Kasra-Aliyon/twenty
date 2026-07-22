import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UniboxContactsService } from 'src/engine/core-modules/unibox/services/unibox-contacts.service';
import { UniboxEmailChannelService } from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import { UniboxEmailThreadsService } from 'src/engine/core-modules/unibox/services/unibox-email-threads.service';
import { UniboxLinkedinThreadsService } from 'src/engine/core-modules/unibox/services/unibox-linkedin-threads.service';
import { UniboxResolver } from 'src/engine/core-modules/unibox/unibox.resolver';
import { RelatedPersonIdsModule } from 'src/engine/core-modules/related-person-ids/related-person-ids.module';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { ContactCreationManagerModule } from 'src/modules/contact-creation-manager/contact-creation-manager.module';
import { MatchParticipantModule } from 'src/modules/match-participant/match-participant.module';

@Module({
  imports: [
    WorkspaceDataSourceModule,
    ContactCreationManagerModule,
    MatchParticipantModule,
    RelatedPersonIdsModule,
    TypeOrmModule.forFeature([ConnectedAccountEntity, MessageChannelEntity]),
  ],
  providers: [
    UniboxResolver,
    UniboxEmailChannelService,
    UniboxEmailThreadsService,
    UniboxLinkedinThreadsService,
    UniboxContactsService,
  ],
})
export class UniboxModule {}
