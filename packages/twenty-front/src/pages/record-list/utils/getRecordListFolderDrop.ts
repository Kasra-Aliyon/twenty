import { RECORD_LIST_DRAG_DROP } from '../constants/record-list-drag-drop.constants';

type RecordListFolderDropTargetData = {
  folderId: string;
  kind: typeof RECORD_LIST_DRAG_DROP.folderDropTargetKind;
};

const isRecordListFolderDropTargetData = (
  data: unknown,
): data is RecordListFolderDropTargetData =>
  typeof data === 'object' &&
  data !== null &&
  'kind' in data &&
  data.kind === RECORD_LIST_DRAG_DROP.folderDropTargetKind &&
  'folderId' in data &&
  typeof data.folderId === 'string';

export const getRecordListFolderDrop = ({
  sourceId,
  targetData,
}: {
  sourceId: unknown;
  targetData: unknown;
}): { folderId: string; listId: string } | null => {
  if (
    typeof sourceId !== 'string' ||
    !sourceId.startsWith(RECORD_LIST_DRAG_DROP.draggableIdPrefix) ||
    !isRecordListFolderDropTargetData(targetData)
  ) {
    return null;
  }

  const listId = sourceId.slice(RECORD_LIST_DRAG_DROP.draggableIdPrefix.length);

  if (listId.length === 0) {
    return null;
  }

  return {
    folderId: targetData.folderId,
    listId,
  };
};
