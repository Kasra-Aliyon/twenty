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

export const buildMessageDraftStandardFlatFieldMetadatas = ({
  now,
  objectName,
  workspaceId,
  standardObjectMetadataRelatedEntityIds,
  dependencyFlatEntityMaps,
  twentyStandardApplicationId,
}: Omit<
  CreateStandardFieldArgs<'messageDraft', FieldMetadataType>,
  'context'
>): Record<AllStandardObjectFieldName<'messageDraft'>, FlatFieldMetadata> => {
  const base = {
    standardObjectMetadataRelatedEntityIds,
    dependencyFlatEntityMaps,
    twentyStandardApplicationId,
    now,
    objectName,
    workspaceId,
  };

  return {
    ...buildRecordListBaseStandardFlatFieldMetadatas(base),
    subject: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'subject',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`Subject`),
        description: i18nLabel(msg`Email subject line`),
        icon: 'IconMail',
        isNullable: false,
        isUIEditable: false,
        defaultValue: "''",
      },
    }),
    body: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'body',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`Body`),
        description: i18nLabel(msg`Email draft body`),
        icon: 'IconFileText',
        isNullable: false,
        isUIEditable: false,
        defaultValue: "''",
      },
    }),
    to: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'to',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`To`),
        description: i18nLabel(msg`Comma-separated primary recipients`),
        icon: 'IconAt',
        isNullable: false,
        isUIEditable: false,
        defaultValue: "''",
      },
    }),
    cc: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'cc',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`Cc`),
        description: i18nLabel(msg`Comma-separated carbon copy recipients`),
        icon: 'IconAt',
        isNullable: false,
        isUIEditable: false,
        defaultValue: "''",
      },
    }),
    bcc: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'bcc',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`Bcc`),
        description: i18nLabel(
          msg`Comma-separated blind carbon copy recipients`,
        ),
        icon: 'IconAt',
        isNullable: false,
        isUIEditable: false,
        defaultValue: "''",
      },
    }),
    inReplyTo: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'inReplyTo',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`In reply to`),
        description: i18nLabel(msg`Header message identifier being replied to`),
        icon: 'IconArrowBackUp',
        isNullable: true,
        isUIEditable: false,
      },
    }),
    connectedAccountId: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'connectedAccountId',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`Connected account id`),
        description: i18nLabel(msg`Sender mailbox connected account id`),
        icon: 'IconMailbox',
        isNullable: false,
        isUIEditable: false,
      },
    }),
    messageThread: createStandardRelationFieldFlatMetadata({
      ...base,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'messageThread',
        label: i18nLabel(msg`Message thread`),
        description: i18nLabel(msg`Message thread this draft replies to`),
        icon: 'IconMessage',
        isNullable: true,
        isUIEditable: false,
        targetObjectName: 'messageThread',
        targetFieldName: 'messageDrafts',
        settings: {
          relationType: RelationType.MANY_TO_ONE,
          onDelete: RelationOnDeleteAction.SET_NULL,
          joinColumnName: 'messageThreadId',
        },
      },
    }),
    author: createStandardRelationFieldFlatMetadata({
      ...base,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'author',
        label: i18nLabel(msg`Author`),
        description: i18nLabel(msg`Workspace member who owns the draft`),
        icon: 'IconUser',
        isNullable: false,
        isUIEditable: false,
        targetObjectName: 'workspaceMember',
        targetFieldName: 'messageDrafts',
        settings: {
          relationType: RelationType.MANY_TO_ONE,
          onDelete: RelationOnDeleteAction.CASCADE,
          joinColumnName: 'authorId',
        },
      },
    }),
    lastEditedAt: createStandardFieldFlatMetadata({
      ...base,
      context: {
        fieldName: 'lastEditedAt',
        type: FieldMetadataType.DATE_TIME,
        label: i18nLabel(msg`Last edited at`),
        description: i18nLabel(msg`Last time the draft content was edited`),
        icon: 'IconCalendarClock',
        isSystem: true,
        isNullable: false,
        isUIEditable: false,
        defaultValue: 'now',
        settings: { displayFormat: DateDisplayFormat.RELATIVE },
      },
    }),
  };
};
