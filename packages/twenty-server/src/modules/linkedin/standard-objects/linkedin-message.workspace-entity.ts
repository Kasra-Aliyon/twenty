import { type ActorMetadata } from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type LinkedinMessageThreadWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message-thread.workspace-entity';

export type LinkedinMessageDirection = 'INBOUND' | 'OUTBOUND';

export class LinkedinMessageWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  position: number;
  searchVector: string;
  externalId: string;
  ownerWorkspaceMemberId: string | null;
  messageId: string;
  body: string;
  deliveredAt: Date;
  direction: LinkedinMessageDirection;
  senderName: string;
  senderLinkedinUrn: string | null;
  ownerLinkedinId: string;
  thread: EntityRelation<LinkedinMessageThreadWorkspaceEntity>;
  threadId: string;
}
