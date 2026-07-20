import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';

export class RecordListFolderWorkspaceEntity extends BaseWorkspaceEntity {
  name: string;
  position: number;
  searchVector: string;
  lists: EntityRelation<RecordListWorkspaceEntity[]>;
}
