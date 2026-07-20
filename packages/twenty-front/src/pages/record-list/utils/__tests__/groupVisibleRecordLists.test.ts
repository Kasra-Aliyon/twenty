import { RECORD_LIST_TYPES } from 'twenty-shared/types';

import { groupVisibleRecordLists } from '~/pages/record-list/utils/groupVisibleRecordLists';

const recordLists = [
  {
    id: 'company-list-id',
    name: 'Enterprise accounts',
    type: RECORD_LIST_TYPES.COMPANY,
    position: 0,
    folderId: 'sales-folder-id',
    folder: { id: 'sales-folder-id', name: 'Sales' },
  },
  {
    id: 'people-list-id',
    name: 'Conference speakers',
    type: RECORD_LIST_TYPES.PERSON,
    position: 0,
    folderId: 'events-folder-id',
    folder: { id: 'events-folder-id', name: 'Events' },
  },
] as never;

describe('groupVisibleRecordLists', () => {
  it('groups searchable lists under their one-level folders', () => {
    expect(
      groupVisibleRecordLists({
        recordLists,
        search: 'enterprise',
        canReadListType: () => true,
      }),
    ).toEqual({
      'sales-folder-id': [expect.objectContaining({ id: 'company-list-id' })],
    });
  });

  it('excludes lists whose target object is not readable', () => {
    expect(
      groupVisibleRecordLists({
        recordLists,
        search: '',
        canReadListType: (type) => type !== RECORD_LIST_TYPES.PERSON,
      }),
    ).toEqual({
      'sales-folder-id': [expect.objectContaining({ id: 'company-list-id' })],
    });
  });
});
