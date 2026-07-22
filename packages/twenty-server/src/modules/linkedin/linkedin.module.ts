import { Module } from '@nestjs/common';

import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { LinkedinThreadParticipantMatchJob } from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
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
import { LinkedinParticipantMatcherService } from 'src/modules/linkedin/services/linkedin-participant-matcher.service';

@Module({
  imports: [WorkspaceCacheModule],
  providers: [
    LinkedinParticipantMatcherService,
    LinkedinThreadParticipantMatchJob,
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
  exports: [LinkedinParticipantMatcherService],
})
export class LinkedinModule {}
