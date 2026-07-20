import { type RecordListType } from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type RecordListFolderWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-folder.workspace-entity';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';

export class RecordListWorkspaceEntity extends BaseWorkspaceEntity {
  name: string;
  type: RecordListType;
  position: number;
  searchVector: string;
  folder: EntityRelation<RecordListFolderWorkspaceEntity> | null;
  folderId: string | null;
  members: EntityRelation<RecordListMemberWorkspaceEntity[]>;
}
