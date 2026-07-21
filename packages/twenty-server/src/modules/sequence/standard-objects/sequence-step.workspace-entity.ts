import {
  type ActorMetadata,
  type SequenceStepSettings,
  type SequenceStepType,
} from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

export class SequenceStepWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  name: string | null;
  type: SequenceStepType;
  settings: SequenceStepSettings;
  position: number;
  searchVector: string;
  sequence: EntityRelation<SequenceWorkspaceEntity>;
  sequenceId: string;
}
