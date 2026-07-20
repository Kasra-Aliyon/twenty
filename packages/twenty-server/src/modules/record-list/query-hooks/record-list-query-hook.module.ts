import { Module } from '@nestjs/common';

import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { ViewFieldModule } from 'src/engine/metadata-modules/view-field/view-field.module';
import { ViewSortModule } from 'src/engine/metadata-modules/view-sort/view-sort.module';
import { ViewModule } from 'src/engine/metadata-modules/view/view.module';
import { TwentyORMModule } from 'src/engine/twenty-orm/twenty-orm.module';
import {
  RecordListCreateManyPostQueryHook,
  RecordListCreateManyPreQueryHook,
  RecordListCreateOnePostQueryHook,
  RecordListCreateOnePreQueryHook,
  RecordListDeleteManyPostQueryHook,
  RecordListDeleteOnePostQueryHook,
  RecordListDestroyManyPostQueryHook,
  RecordListDestroyOnePostQueryHook,
  RecordListFolderCreateOnePreQueryHook,
  RecordListFolderCreateManyPreQueryHook,
  RecordListFolderDeleteOnePreQueryHook,
  RecordListFolderDeleteManyPreQueryHook,
  RecordListFolderDestroyManyPreQueryHook,
  RecordListFolderDestroyOnePreQueryHook,
  RecordListFolderUpdateOnePreQueryHook,
  RecordListFolderUpdateManyPreQueryHook,
  RecordListMemberCreateManyPreQueryHook,
  RecordListMemberCreateOnePreQueryHook,
  RecordListMemberUpdateManyPreQueryHook,
  RecordListMemberUpdateOnePreQueryHook,
  RecordListUpdateManyPreQueryHook,
  RecordListUpdateOnePreQueryHook,
} from 'src/modules/record-list/query-hooks/record-list.query-hooks';
import { RecordListValidationService } from 'src/modules/record-list/services/record-list-validation.service';
import { RecordListViewService } from 'src/modules/record-list/services/record-list-view.service';

@Module({
  imports: [
    TwentyORMModule,
    ViewModule,
    ViewFieldModule,
    ViewSortModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
  ],
  providers: [
    RecordListValidationService,
    RecordListViewService,
    RecordListFolderCreateOnePreQueryHook,
    RecordListFolderCreateManyPreQueryHook,
    RecordListFolderUpdateOnePreQueryHook,
    RecordListFolderUpdateManyPreQueryHook,
    RecordListFolderDeleteOnePreQueryHook,
    RecordListFolderDeleteManyPreQueryHook,
    RecordListFolderDestroyManyPreQueryHook,
    RecordListFolderDestroyOnePreQueryHook,
    RecordListCreateOnePreQueryHook,
    RecordListCreateManyPreQueryHook,
    RecordListUpdateOnePreQueryHook,
    RecordListUpdateManyPreQueryHook,
    RecordListCreateOnePostQueryHook,
    RecordListCreateManyPostQueryHook,
    RecordListDeleteOnePostQueryHook,
    RecordListDeleteManyPostQueryHook,
    RecordListDestroyOnePostQueryHook,
    RecordListDestroyManyPostQueryHook,
    RecordListMemberCreateOnePreQueryHook,
    RecordListMemberCreateManyPreQueryHook,
    RecordListMemberUpdateOnePreQueryHook,
    RecordListMemberUpdateManyPreQueryHook,
  ],
})
export class RecordListQueryHookModule {}
