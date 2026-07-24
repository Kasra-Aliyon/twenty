import {
  type ActorMetadata,
  type LinkedInActionStatus,
  type LinkedInActionType,
  type LinkedInConnectionState,
} from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export class LinkedinActionWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  type: LinkedInActionType;
  status: LinkedInActionStatus;
  scheduledAt: Date;
  claimedAt: Date | null;
  claimedBy: string | null;
  executedAt: Date | null;
  attemptCount: number;
  errorMessage: string | null;
  ownerWorkspaceMemberId: string | null;
  linkedinUrl: string;
  noteText: string;
  connectionState: LinkedInConnectionState;
  person: EntityRelation<PersonWorkspaceEntity>;
  personId: string;
  sequenceEnrollmentId: string | null;
  sequenceStepId: string | null;
  position: number;
  searchVector: string;
}
