import { msg } from '@lingui/core/macro';
import { DateDisplayFormat, FieldMetadataType } from 'twenty-shared/types';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { i18nLabel } from 'src/engine/workspace-manager/twenty-standard-application/utils/i18n-label.util';
import {
  type CreateStandardFieldArgs,
  createStandardFieldFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-field-flat-metadata.util';
import { getTsVectorColumnExpressionFromFields } from 'src/engine/workspace-manager/utils/get-ts-vector-column-expression.util';

type RecordListStandardObjectName =
  | 'recordListFolder'
  | 'recordList'
  | 'recordListMember'
  | 'sequence'
  | 'sequenceStep'
  | 'sequenceEnrollment';

type RecordListBaseFieldName =
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'createdBy'
  | 'updatedBy'
  | 'position'
  | 'searchVector';

export const buildRecordListBaseStandardFlatFieldMetadatas = <
  TObjectName extends RecordListStandardObjectName,
>({
  objectName,
  workspaceId,
  standardObjectMetadataRelatedEntityIds,
  dependencyFlatEntityMaps,
  twentyStandardApplicationId,
  now,
}: Omit<
  CreateStandardFieldArgs<TObjectName, FieldMetadataType>,
  'context'
>): Record<RecordListBaseFieldName, FlatFieldMetadata> => {
  const createField = (
    context: CreateStandardFieldArgs<TObjectName, FieldMetadataType>['context'],
  ) =>
    createStandardFieldFlatMetadata({
      objectName,
      workspaceId,
      context,
      standardObjectMetadataRelatedEntityIds,
      dependencyFlatEntityMaps,
      twentyStandardApplicationId,
      now,
    });

  return {
    id: createField({
      fieldName: 'id',
      type: FieldMetadataType.UUID,
      label: i18nLabel(msg`Id`),
      description: i18nLabel(msg`Id`),
      icon: 'Icon123',
      isSystem: true,
      isNullable: false,
      isUIEditable: false,
      defaultValue: 'uuid',
    }),
    createdAt: createField({
      fieldName: 'createdAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Creation date`),
      description: i18nLabel(msg`Creation date`),
      icon: 'IconCalendar',
      isSystem: true,
      isNullable: false,
      isUIEditable: false,
      defaultValue: 'now',
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    }),
    updatedAt: createField({
      fieldName: 'updatedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Last update`),
      description: i18nLabel(msg`Last time the record was changed`),
      icon: 'IconCalendarClock',
      isSystem: true,
      isNullable: false,
      isUIEditable: false,
      defaultValue: 'now',
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    }),
    deletedAt: createField({
      fieldName: 'deletedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Deleted at`),
      description: i18nLabel(msg`Date when the record was deleted`),
      icon: 'IconCalendarMinus',
      isSystem: true,
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    }),
    createdBy: createField({
      fieldName: 'createdBy',
      type: FieldMetadataType.ACTOR,
      label: i18nLabel(msg`Created by`),
      description: i18nLabel(msg`The creator of the record`),
      icon: 'IconCreativeCommonsSa',
      isSystem: true,
      isUIEditable: false,
      isNullable: false,
      defaultValue: {
        source: "'MANUAL'",
        name: "'System'",
        workspaceMemberId: null,
      },
    }),
    updatedBy: createField({
      fieldName: 'updatedBy',
      type: FieldMetadataType.ACTOR,
      label: i18nLabel(msg`Updated by`),
      description: i18nLabel(
        msg`The workspace member who last updated the record`,
      ),
      icon: 'IconUserCircle',
      isSystem: true,
      isUIEditable: false,
      isNullable: false,
      defaultValue: {
        source: "'MANUAL'",
        name: "'System'",
        workspaceMemberId: null,
      },
    }),
    position: createField({
      fieldName: 'position',
      type: FieldMetadataType.POSITION,
      label: i18nLabel(msg`Position`),
      description: i18nLabel(msg`Record position`),
      icon: 'IconHierarchy2',
      isSystem: true,
      isNullable: false,
      defaultValue: 0,
    }),
    searchVector: createField({
      fieldName: 'searchVector',
      type: FieldMetadataType.TS_VECTOR,
      label: i18nLabel(msg`Search vector`),
      description: i18nLabel(msg`Field used for full-text search`),
      icon: 'IconSearch',
      isSystem: true,
      isNullable: true,
      settings: {
        generatedType: 'STORED',
        asExpression: getTsVectorColumnExpressionFromFields([
          { name: 'id', type: FieldMetadataType.UUID },
        ]),
      },
    }),
  };
};
