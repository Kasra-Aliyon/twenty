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

export const buildRecordListFolderStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'recordListFolder', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'recordListFolder'>,
  FlatFieldMetadata
> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  name: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'name',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Name`),
      description: i18nLabel(msg`Record list folder name`),
      icon: 'IconFolder',
      isNullable: false,
    },
  }),
  lists: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'lists',
      label: i18nLabel(msg`Lists`),
      description: i18nLabel(msg`Lists in this folder`),
      icon: 'IconListDetails',
      isNullable: true,
      isUIEditable: false,
      targetObjectName: 'recordList',
      targetFieldName: 'folder',
      settings: { relationType: RelationType.ONE_TO_MANY },
    },
  }),
});
