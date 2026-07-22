export const UNIBOX_DEFAULT_PAGE_SIZE = 30;
export const UNIBOX_MAX_PAGE_SIZE = 100;
export const UNIBOX_MAX_CONTACTS_TO_ADD = 1000;
export const UNIBOX_MESSAGE_PREVIEW_LENGTH = 200;
// Gmail exposes read state as an UNREAD system label, which the folder sync
// stores like any other folder. Microsoft and IMAP have no equivalent folder and
// their read state is not persisted, so their threads all read as read.
export const UNIBOX_UNREAD_FOLDER_NAME = 'UNREAD';
