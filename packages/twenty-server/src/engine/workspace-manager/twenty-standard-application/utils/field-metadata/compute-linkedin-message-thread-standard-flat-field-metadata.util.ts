import { msg } from '@lingui/core/macro';
import {
  DateDisplayFormat,
  FieldMetadataType,
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

export const buildLinkedinMessageThreadStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'linkedinMessageThread', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'linkedinMessageThread'>,
  FlatFieldMetadata
> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  externalId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'externalId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`External ID`),
      description: i18nLabel(msg`Stable owner-scoped LinkedIn thread ID`),
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
        msg`Workspace member that owns this LinkedIn thread`,
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
      description: i18nLabel(msg`LinkedIn conversation name`),
      icon: 'IconMessages',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  threadId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'threadId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Thread ID`),
      description: i18nLabel(msg`LinkedIn provider conversation ID`),
      icon: 'IconHash',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  firstMessageTime: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'firstMessageTime',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`First message time`),
      description: i18nLabel(msg`Time of the first harvested message`),
      icon: 'IconCalendar',
      isNullable: false,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  lastMessageTime: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'lastMessageTime',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Last message time`),
      description: i18nLabel(msg`Time of the latest harvested message`),
      icon: 'IconCalendarClock',
      isNullable: false,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  labels: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'labels',
      type: FieldMetadataType.RAW_JSON,
      label: i18nLabel(msg`Labels`),
      description: i18nLabel(msg`LinkedIn conversation labels`),
      icon: 'IconTags',
      isNullable: false,
      isUIEditable: false,
      defaultValue: [],
    },
  }),
  ownerLinkedinId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'ownerLinkedinId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Owner LinkedIn ID`),
      description: i18nLabel(msg`LinkedIn member that owns the conversation`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  lastMessagePreview: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'lastMessagePreview',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Last message preview`),
      description: i18nLabel(msg`Preview of the latest LinkedIn message`),
      icon: 'IconMessage',
      isNullable: false,
      isUIEditable: false,
      defaultValue: "''",
    },
  }),
  messageCount: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'messageCount',
      type: FieldMetadataType.NUMBER,
      label: i18nLabel(msg`Message count`),
      description: i18nLabel(msg`Number of harvested messages`),
      icon: 'IconListNumbers',
      isNullable: false,
      isUIEditable: false,
      defaultValue: 0,
    },
  }),
  messages: {
    ...createStandardRelationFieldFlatMetadata({
      ...args,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'messages',
        label: i18nLabel(msg`Messages`),
        description: i18nLabel(msg`Messages in the LinkedIn conversation`),
        icon: 'IconMessage',
        isNullable: false,
        isUIEditable: false,
        targetObjectName: 'linkedinMessage',
        targetFieldName: 'thread',
        settings: { relationType: RelationType.ONE_TO_MANY },
      },
    }),
    // Query hooks do not run for nested relation selections.
    isActive: false,
  },
  participants: {
    ...createStandardRelationFieldFlatMetadata({
      ...args,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'participants',
        label: i18nLabel(msg`Participants`),
        description: i18nLabel(msg`Participants in the LinkedIn conversation`),
        icon: 'IconUsers',
        isNullable: false,
        isUIEditable: false,
        targetObjectName: 'linkedinThreadParticipant',
        targetFieldName: 'thread',
        settings: { relationType: RelationType.ONE_TO_MANY },
      },
    }),
    // Query hooks do not run for nested relation selections.
    isActive: false,
  },
});
