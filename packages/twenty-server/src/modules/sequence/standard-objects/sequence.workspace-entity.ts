import {
  type ActorMetadata,
  type SequenceSettings,
  type SequenceStatus,
} from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';

export class SequenceWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  name: string;
  status: SequenceStatus;
  senderConnectedAccountId: string | null;
  settings: SequenceSettings;
  enrolledCount: number;
  activeCount: number;
  completedCount: number;
  repliedCount: number;
  failedCount: number;
  position: number;
  searchVector: string;
  steps: EntityRelation<SequenceStepWorkspaceEntity[]>;
  enrollments: EntityRelation<SequenceEnrollmentWorkspaceEntity[]>;
}
