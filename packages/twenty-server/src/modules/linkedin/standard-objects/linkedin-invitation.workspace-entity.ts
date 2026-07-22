import { type ActorMetadata } from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';

export type LinkedinInvitationDirection = 'SENT' | 'RECEIVED';

export class LinkedinInvitationWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  position: number;
  searchVector: string;
  externalId: string;
  ownerWorkspaceMemberId: string | null;
  name: string;
  direction: LinkedinInvitationDirection;
  handle: string;
  headline: string | null;
  message: string | null;
  sentAt: Date | null;
  ownerLinkedinId: string;
}
