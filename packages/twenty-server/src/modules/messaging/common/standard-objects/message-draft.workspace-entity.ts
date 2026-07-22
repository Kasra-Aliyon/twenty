import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type MessageThreadWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-thread.workspace-entity';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

export class MessageDraftWorkspaceEntity extends BaseWorkspaceEntity {
  subject: string;
  body: string;
  to: string;
  cc: string;
  bcc: string;
  inReplyTo: string | null;
  connectedAccountId: string;
  messageThread: EntityRelation<MessageThreadWorkspaceEntity> | null;
  messageThreadId: string | null;
  author: EntityRelation<WorkspaceMemberWorkspaceEntity>;
  authorId: string;
  lastEditedAt: Date;
}
