export const ROOT_RECORD_LIST_FOLDER_ID = '';

export function getRecordListFolderKey(
  folderId: string | null | undefined,
): string {
  return folderId ?? ROOT_RECORD_LIST_FOLDER_ID;
}
