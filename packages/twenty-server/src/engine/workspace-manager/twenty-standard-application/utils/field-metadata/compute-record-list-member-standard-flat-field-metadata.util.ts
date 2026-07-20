import { msg } from '@lingui/core/macro';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type AllStandardObjectFieldName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-field-name.type';
import { buildRecordListBaseStandardFlatFieldMetadatas } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/build-record-list-base-standard-flat-field-metadatas.util';
import { type CreateStandardFieldArgs } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-field-flat-metadata.util';
import { createStandardRelationFieldFlatMetadata } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-relation-field-flat-metadata.util';
import { i18nLabel } from 'src/engine/workspace-manager/twenty-standard-application/utils/i18n-label.util';

export const buildRecordListMemberStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'recordListMember', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'recordListMember'>,
  FlatFieldMetadata
> => {
  const createTargetRelation = ({
    fieldName,
    targetObjectName,
  }: {
    fieldName: 'targetCompany' | 'targetPerson' | 'targetOpportunity';
    targetObjectName: 'company' | 'person' | 'opportunity';
  }) =>
    createStandardRelationFieldFlatMetadata({
      ...args,
      context: {
        type: FieldMetadataType.MORPH_RELATION,
        morphId:
          STANDARD_OBJECTS.recordListMember.morphIds.targetMorphId.morphId,
        fieldName,
        label: i18nLabel(msg`Target`),
        description: i18nLabel(msg`Record in the list`),
        icon: 'IconArrowUpRight',
        isNullable: true,
        isUIEditable: false,
        targetObjectName,
        targetFieldName: 'recordListMemberships',
        settings: {
          relationType: RelationType.MANY_TO_ONE,
          onDelete: RelationOnDeleteAction.CASCADE,
          joinColumnName: `${fieldName}Id`,
        },
      },
    });

  return {
    ...buildRecordListBaseStandardFlatFieldMetadatas(args),
    recordList: createStandardRelationFieldFlatMetadata({
      ...args,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'recordList',
        label: i18nLabel(msg`List`),
        description: i18nLabel(msg`List containing this record`),
        icon: 'IconListDetails',
        isNullable: false,
        targetObjectName: 'recordList',
        targetFieldName: 'members',
        settings: {
          relationType: RelationType.MANY_TO_ONE,
          onDelete: RelationOnDeleteAction.CASCADE,
          joinColumnName: 'recordListId',
        },
      },
    }),
    targetCompany: createTargetRelation({
      fieldName: 'targetCompany',
      targetObjectName: 'company',
    }),
    targetPerson: createTargetRelation({
      fieldName: 'targetPerson',
      targetObjectName: 'person',
    }),
    targetOpportunity: createTargetRelation({
      fieldName: 'targetOpportunity',
      targetObjectName: 'opportunity',
    }),
  };
};
