import { type RecordListRecord } from '../types/RecordListRecords';
import { type RecordListType } from 'twenty-shared/types';

export const groupVisibleRecordLists = ({
  recordLists,
  search,
  canReadListType,
}: {
  recordLists: RecordListRecord[];
  search: string;
  canReadListType: (recordListType: RecordListType) => boolean;
}): Record<string, RecordListRecord[]> => {
  const normalizedSearch = search.toLocaleLowerCase();

  return recordLists.reduce<Record<string, RecordListRecord[]>>(
    (listsByFolderId, recordList) => {
      if (
        !canReadListType(recordList.type) ||
        !recordList.name.toLocaleLowerCase().includes(normalizedSearch)
      ) {
        return listsByFolderId;
      }

      listsByFolderId[recordList.folderId] = [
        ...(listsByFolderId[recordList.folderId] ?? []),
        recordList,
      ];

      return listsByFolderId;
    },
    {},
  );
};
