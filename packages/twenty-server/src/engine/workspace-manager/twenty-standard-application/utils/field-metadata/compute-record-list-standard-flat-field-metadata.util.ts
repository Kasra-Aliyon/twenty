import { msg } from '@lingui/core/macro';
import { FieldMetadataType, RelationType } from 'twenty-shared/types';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type AllStandardObjectFieldName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-field-name.type';
import { buildRecordListBaseStandardFlatFieldMetadatas } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/build-record-list-base-standard-flat-field-metadatas.util';
import {
  type CreateStandardFieldArgs,
  createStandardFieldFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-field-flat-metadata.util';
import { createStandardRelationFieldFlatMetadata } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-relation-field-flat-metadata.util';
import { i18nLabel } from 'src/engine/workspace-manager/twenty-standard-application/utils/i18n-label.util';

export const buildRecordListStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'recordList', FieldMetadataType>,
    'context'
  >,
): Record<AllStandardObjectFieldName<'recordList'>, FlatFieldMetadata> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  name: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'name',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Name`),
      description: i18nLabel(msg`Record list name`),
      icon: 'IconListDetails',
      isNullable: false,
    },
  }),
  type: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'type',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Type`),
      description: i18nLabel(msg`Type of records in this list`),
      icon: 'IconCategory',
      isNullable: false,
      options: [
        {
          id: '03357fbc-7120-4355-95ca-d20b01935d5c',
          value: 'COMPANY',
          label: i18nLabel(msg`Company`),
          position: 0,
          color: 'blue',
        },
        {
          id: 'a4e0eda5-80e8-45dd-be1e-3ffcfe3bb834',
          value: 'PERSON',
          label: i18nLabel(msg`Person`),
          position: 1,
          color: 'purple',
        },
        {
          id: 'a546105b-a8f4-40a4-a206-e2bb22dc0bad',
          value: 'OPPORTUNITY',
          label: i18nLabel(msg`Opportunity`),
          position: 2,
          color: 'red',
        },
      ],
    },
  }),
  folder: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'folder',
      label: i18nLabel(msg`Folder`),
      description: i18nLabel(msg`Folder containing this list`),
      icon: 'IconFolder',
      isNullable: true,
      targetObjectName: 'recordListFolder',
      targetFieldName: 'lists',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        joinColumnName: 'folderId',
      },
    },
  }),
  members: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'members',
      label: i18nLabel(msg`Members`),
      description: i18nLabel(msg`Records in this list`),
      icon: 'IconUsersGroup',
      isNullable: true,
      isUIEditable: false,
      targetObjectName: 'recordListMember',
      targetFieldName: 'recordList',
      settings: { relationType: RelationType.ONE_TO_MANY },
    },
  }),
});
