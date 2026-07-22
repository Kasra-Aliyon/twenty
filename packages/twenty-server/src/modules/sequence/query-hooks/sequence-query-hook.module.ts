import { Module } from '@nestjs/common';

import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
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
  providers: [
    SequenceInvariantService,
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
