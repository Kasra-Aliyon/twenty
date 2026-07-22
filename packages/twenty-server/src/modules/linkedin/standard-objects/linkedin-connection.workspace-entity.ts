import { type ActorMetadata, type LinksMetadata } from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export class LinkedinConnectionWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  position: number;
  searchVector: string;
  externalId: string;
  ownerWorkspaceMemberId: string | null;
  name: string;
  handle: string;
  headline: string | null;
  profileUrl: LinksMetadata;
  linkedinUrn: string;
  connectedAt: Date | null;
  ownerLinkedinId: string;
  person: EntityRelation<PersonWorkspaceEntity> | null;
  personId: string | null;
}
