import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { type RecordListType } from 'twenty-shared/types';

export type RecordListFolderRecord = ObjectRecord & {
  name: string;
  position: number;
};

export type RecordListRecord = ObjectRecord & {
  name: string;
  type: RecordListType;
  position: number;
  folderId: string | null;
  folder: { id: string; name: string } | null;
};

export type EditingRecordListItem = {
  kind: 'folder' | 'list';
  id: string;
  name: string;
};
