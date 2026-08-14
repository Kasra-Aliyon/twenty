import { type ObjectRecordBaseEvent } from 'twenty-shared/database-events';

export type TimelineActivityPayload = {
  id?: string;
  happensAt?: Date;
  properties: ObjectRecordBaseEvent['properties'];
  linkedObjectMetadataId?: string;
  linkedRecordId?: string;
  linkedRecordCachedName?: string;
  workspaceMemberId?: string;
  name: string;
  recordId: string;
  objectSingularName?: string;
};
