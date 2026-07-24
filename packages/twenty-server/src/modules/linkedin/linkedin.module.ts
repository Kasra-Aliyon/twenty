import { Module } from '@nestjs/common';

import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { LinkedinConnectionMatchJob } from 'src/modules/linkedin/jobs/linkedin-connection-match.job';
import { LinkedinThreadParticipantMatchJob } from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
import { LinkedinConnectionPersonListener } from 'src/modules/linkedin/listeners/linkedin-connection-person.listener';
import { LinkedinConnectionListener } from 'src/modules/linkedin/listeners/linkedin-connection.listener';
import { LinkedinThreadParticipantPersonListener } from 'src/modules/linkedin/listeners/linkedin-thread-participant-person.listener';
import { LinkedinThreadParticipantListener } from 'src/modules/linkedin/listeners/linkedin-thread-participant.listener';
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

@Module({
  imports: [WorkspaceCacheModule],
  providers: [
    LinkedinConnectionMatcherService,
    LinkedinParticipantMatcherService,
    LinkedinConnectionMatchJob,
    LinkedinThreadParticipantMatchJob,
    LinkedinConnectionListener,
    LinkedinConnectionPersonListener,
    LinkedinThreadParticipantListener,
    LinkedinThreadParticipantPersonListener,
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
