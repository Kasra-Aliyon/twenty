import { RECORD_LIST_DRAG_DROP } from '~/pages/record-list/constants/record-list-drag-drop.constants';
import { getRecordListFolderDrop } from '~/pages/record-list/utils/getRecordListFolderDrop';

describe('getRecordListFolderDrop', () => {
  it('resolves a list dropped on a folder header', () => {
    expect(
      getRecordListFolderDrop({
        sourceId: 'record-list:list-id',
        targetData: {
          folderId: 'folder-id',
          kind: RECORD_LIST_DRAG_DROP.folderDropTargetKind,
        },
      }),
    ).toEqual({
      folderId: 'folder-id',
      listId: 'list-id',
    });
  });

  it('ignores folder drags and unrelated drop targets', () => {
    expect(
      getRecordListFolderDrop({
        sourceId: 'record-list-folder:folder-id',
        targetData: {
          folderId: 'other-folder-id',
          kind: RECORD_LIST_DRAG_DROP.folderDropTargetKind,
        },
      }),
    ).toBeNull();

    expect(
      getRecordListFolderDrop({
        sourceId: 'record-list:list-id',
        targetData: { kind: 'another-target' },
      }),
    ).toBeNull();
  });
});
