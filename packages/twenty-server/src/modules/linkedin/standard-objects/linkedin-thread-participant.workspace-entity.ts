import { type ActorMetadata, type LinksMetadata } from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type LinkedinMessageThreadWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message-thread.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export class LinkedinThreadParticipantWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  position: number;
  searchVector: string;
  externalId: string;
  ownerWorkspaceMemberId: string | null;
  linkedinUrn: string | null;
  linkedinMemberId: string | null;
  name: string;
  headline: string | null;
  handle: string | null;
  profileUrl: LinksMetadata | null;
  isSelf: boolean;
  thread: EntityRelation<LinkedinMessageThreadWorkspaceEntity>;
  threadId: string;
  person: EntityRelation<PersonWorkspaceEntity> | null;
  personId: string | null;
}
