import { msg } from '@lingui/core/macro';
import {
  DateDisplayFormat,
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type AllStandardObjectFieldName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-field-name.type';
import { buildRecordListBaseStandardFlatFieldMetadatas } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/build-record-list-base-standard-flat-field-metadatas.util';
import {
  type CreateStandardFieldArgs,
  createStandardFieldFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-field-flat-metadata.util';
import { createStandardRelationFieldFlatMetadata } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-relation-field-flat-metadata.util';
import { i18nLabel } from 'src/engine/workspace-manager/twenty-standard-application/utils/i18n-label.util';

export const buildLinkedinConnectionStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'linkedinConnection', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'linkedinConnection'>,
  FlatFieldMetadata
> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  externalId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'externalId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`External ID`),
      description: i18nLabel(msg`Stable owner-scoped LinkedIn connection ID`),
      icon: 'IconKey',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  ownerWorkspaceMemberId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'ownerWorkspaceMemberId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Owner workspace member ID`),
      description: i18nLabel(
        msg`Workspace member that owns this LinkedIn connection`,
      ),
      icon: 'IconLock',
      isSystem: true,
      isNullable: true,
      isUIEditable: false,
    },
  }),
  name: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'name',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Name`),
      description: i18nLabel(msg`LinkedIn connection name`),
      icon: 'IconUser',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  handle: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'handle',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`LinkedIn handle`),
      description: i18nLabel(msg`LinkedIn public profile handle`),
      icon: 'IconAt',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  headline: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'headline',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Headline`),
      description: i18nLabel(msg`LinkedIn profile headline`),
      icon: 'IconBriefcase',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  profileUrl: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'profileUrl',
      type: FieldMetadataType.LINKS,
      label: i18nLabel(msg`Profile URL`),
      description: i18nLabel(msg`LinkedIn public profile URL`),
      icon: 'IconLink',
      isNullable: false,
      isUIEditable: false,
      settings: { maxNumberOfValues: 1 },
    },
  }),
  linkedinUrn: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'linkedinUrn',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`LinkedIn URN`),
      description: i18nLabel(msg`LinkedIn profile URN`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  connectedAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'connectedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Connected at`),
      description: i18nLabel(msg`Time the LinkedIn connection was established`),
      icon: 'IconCalendarClock',
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  ownerLinkedinId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'ownerLinkedinId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Owner LinkedIn ID`),
      description: i18nLabel(msg`LinkedIn member that owns the connection`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  person: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'person',
      label: i18nLabel(msg`Person`),
      description: i18nLabel(msg`Twenty person matched to the connection`),
      icon: 'IconUser',
      isNullable: true,
      isUIEditable: false,
      targetObjectName: 'person',
      targetFieldName: 'linkedinConnections',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.SET_NULL,
        joinColumnName: 'personId',
      },
    },
  }),
});
