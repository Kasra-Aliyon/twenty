import { type ActorMetadata } from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';

export class LinkedinMessageThreadWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  position: number;
  searchVector: string;
  externalId: string;
  ownerWorkspaceMemberId: string | null;
  name: string;
  threadId: string;
  firstMessageTime: Date;
  lastMessageTime: Date;
  labels: string[];
  ownerLinkedinId: string;
  lastMessagePreview: string;
  messageCount: number;
  messages: EntityRelation<LinkedinMessageWorkspaceEntity[]>;
  participants: EntityRelation<LinkedinThreadParticipantWorkspaceEntity[]>;
}
