import { Module } from '@nestjs/common';

import { ObjectMetadataRepositoryModule } from 'src/engine/object-metadata-repository/object-metadata-repository.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { LinkedinConnectionMatchJob } from 'src/modules/linkedin/jobs/linkedin-connection-match.job';
import { LinkedinThreadParticipantMatchJob } from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
import { LinkedinConnectionPersonListener } from 'src/modules/linkedin/listeners/linkedin-connection-person.listener';
import { LinkedinConnectionListener } from 'src/modules/linkedin/listeners/linkedin-connection.listener';
import { LinkedinThreadParticipantPersonListener } from 'src/modules/linkedin/listeners/linkedin-thread-participant-person.listener';
import { LinkedinThreadParticipantListener } from 'src/modules/linkedin/listeners/linkedin-thread-participant.listener';
import { LinkedinTimelineActivityListener } from 'src/modules/linkedin/listeners/linkedin-timeline-activity.listener';
import { LinkedinRecordAccessService } from 'src/modules/linkedin/query-hooks/linkedin-record-access.service';
import {
  LinkedinRecordCreateManyPreQueryHook,
  LinkedinRecordCreateOnePreQueryHook,
  LinkedinRecordDeleteManyPreQueryHook,
  LinkedinRecordDeleteOnePreQueryHook,
  LinkedinRecordDestroyManyPreQueryHook,
  LinkedinRecordDestroyOnePreQueryHook,
  LinkedinRecordFindDuplicatesPreQueryHook,
  LinkedinRecordFindManyPreQueryHook,
  LinkedinRecordFindOnePreQueryHook,
  LinkedinRecordGroupByPreQueryHook,
  LinkedinRecordMergeManyPreQueryHook,
  LinkedinRecordRestoreManyPreQueryHook,
  LinkedinRecordRestoreOnePreQueryHook,
  LinkedinRecordUpdateManyPreQueryHook,
  LinkedinRecordUpdateOnePreQueryHook,
} from 'src/modules/linkedin/query-hooks/linkedin-record.query-hooks';
import { LinkedinConnectionMatcherService } from 'src/modules/linkedin/services/linkedin-connection-matcher.service';
import { LinkedinParticipantMatcherService } from 'src/modules/linkedin/services/linkedin-participant-matcher.service';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

@Module({
  imports: [
    ObjectMetadataRepositoryModule.forFeature([
      TimelineActivityWorkspaceEntity,
    ]),
    WorkspaceCacheModule,
  ],
  providers: [
    LinkedinConnectionMatcherService,
    LinkedinParticipantMatcherService,
    LinkedinConnectionMatchJob,
    LinkedinThreadParticipantMatchJob,
    LinkedinConnectionListener,
    LinkedinConnectionPersonListener,
    LinkedinThreadParticipantListener,
    LinkedinThreadParticipantPersonListener,
    LinkedinTimelineActivityListener,
    LinkedinRecordAccessService,
    LinkedinRecordFindManyPreQueryHook,
    LinkedinRecordFindOnePreQueryHook,
    LinkedinRecordGroupByPreQueryHook,
    LinkedinRecordFindDuplicatesPreQueryHook,
    LinkedinRecordCreateOnePreQueryHook,
    LinkedinRecordCreateManyPreQueryHook,
    LinkedinRecordUpdateOnePreQueryHook,
    LinkedinRecordUpdateManyPreQueryHook,
    LinkedinRecordDeleteOnePreQueryHook,
    LinkedinRecordDeleteManyPreQueryHook,
    LinkedinRecordDestroyOnePreQueryHook,
    LinkedinRecordDestroyManyPreQueryHook,
    LinkedinRecordRestoreOnePreQueryHook,
    LinkedinRecordRestoreManyPreQueryHook,
    LinkedinRecordMergeManyPreQueryHook,
  ],
  exports: [
    LinkedinConnectionMatcherService,
    LinkedinParticipantMatcherService,
  ],
})
export class LinkedinModule {}
