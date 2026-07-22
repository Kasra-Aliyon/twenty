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

export const buildLinkedinMessageStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'linkedinMessage', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'linkedinMessage'>,
  FlatFieldMetadata
> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  externalId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'externalId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`External ID`),
      description: i18nLabel(msg`Stable owner-scoped LinkedIn message ID`),
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
        msg`Workspace member that owns this LinkedIn message`,
      ),
      icon: 'IconLock',
      isSystem: true,
      isNullable: true,
      isUIEditable: false,
    },
  }),
  messageId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'messageId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Message ID`),
      description: i18nLabel(msg`LinkedIn provider message ID`),
      icon: 'IconHash',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  body: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'body',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Body`),
      description: i18nLabel(msg`LinkedIn message body`),
      icon: 'IconFileText',
      isNullable: false,
      isUIEditable: false,
      defaultValue: "''",
    },
  }),
  deliveredAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'deliveredAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Delivered at`),
      description: i18nLabel(msg`Time the LinkedIn message was delivered`),
      icon: 'IconCalendarClock',
      isNullable: false,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  direction: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'direction',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Direction`),
      description: i18nLabel(msg`LinkedIn message direction`),
      icon: 'IconArrowsExchange',
      isNullable: false,
      isUIEditable: false,
      options: [
        {
          id: 'a2c5ae55-608f-410d-8e44-695e00d7e0d0',
          value: 'INBOUND',
          label: i18nLabel(msg`Inbound`),
          position: 0,
          color: 'blue',
        },
        {
          id: '74485003-d9d9-48a4-ab18-7d234dd1e02a',
          value: 'OUTBOUND',
          label: i18nLabel(msg`Outbound`),
          position: 1,
          color: 'purple',
        },
      ],
    },
  }),
  senderName: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'senderName',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Sender name`),
      description: i18nLabel(msg`Display name of the LinkedIn sender`),
      icon: 'IconUser',
      isNullable: false,
      isUIEditable: false,
      defaultValue: "''",
    },
  }),
  senderLinkedinUrn: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'senderLinkedinUrn',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Sender LinkedIn URN`),
      description: i18nLabel(msg`LinkedIn profile URN of the sender`),
      icon: 'IconBrandLinkedin',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  ownerLinkedinId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'ownerLinkedinId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Owner LinkedIn ID`),
      description: i18nLabel(msg`LinkedIn member that owns the message`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  thread: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'thread',
      label: i18nLabel(msg`Thread`),
      description: i18nLabel(msg`LinkedIn conversation containing the message`),
      icon: 'IconMessages',
      isNullable: false,
      isUIEditable: false,
      targetObjectName: 'linkedinMessageThread',
      targetFieldName: 'messages',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'threadId',
      },
    },
  }),
});
