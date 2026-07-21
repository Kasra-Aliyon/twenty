import { msg } from '@lingui/core/macro';
import {
  FieldMetadataType,
  RelationType,
  SEQUENCE_STATUSES,
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

export const buildSequenceStandardFlatFieldMetadatas = (
  args: Omit<CreateStandardFieldArgs<'sequence', FieldMetadataType>, 'context'>,
): Record<AllStandardObjectFieldName<'sequence'>, FlatFieldMetadata> => {
  const createCountField = ({
    fieldName,
    label,
    description,
  }: {
    fieldName:
      | 'enrolledCount'
      | 'activeCount'
      | 'completedCount'
      | 'repliedCount'
      | 'failedCount';
    label: string;
    description: string;
  }) =>
    createStandardFieldFlatMetadata({
      ...args,
      context: {
        fieldName,
        type: FieldMetadataType.NUMBER,
        label,
        description,
        icon: 'IconChartBar',
        isSystem: true,
        isUIEditable: false,
        isNullable: false,
        defaultValue: 0,
      },
    });

  return {
    ...buildRecordListBaseStandardFlatFieldMetadatas(args),
    name: createStandardFieldFlatMetadata({
      ...args,
      context: {
        fieldName: 'name',
        type: FieldMetadataType.TEXT,
        label: i18nLabel(msg`Name`),
        description: i18nLabel(msg`Sequence name`),
        icon: 'IconSend',
        isNullable: false,
      },
    }),
    status: createStandardFieldFlatMetadata({
      ...args,
      context: {
        fieldName: 'status',
        type: FieldMetadataType.SELECT,
        label: i18nLabel(msg`Status`),
        description: i18nLabel(msg`Sequence status`),
        icon: 'IconStatusChange',
        isNullable: false,
        defaultValue: `'${SEQUENCE_STATUSES.DRAFT}'`,
        options: [
          {
            id: '39a9c94b-3fc9-472c-9a91-ef20a101c33f',
            value: SEQUENCE_STATUSES.DRAFT,
            label: i18nLabel(msg`Draft`),
            position: 0,
            color: 'gray',
          },
          {
            id: '281e4a76-e6dd-48e6-9e7a-d428bd11d3ed',
            value: SEQUENCE_STATUSES.ACTIVE,
            label: i18nLabel(msg`Active`),
            position: 1,
            color: 'green',
          },
          {
            id: '1a7a0290-7829-4349-9699-6e2c7a98f3a9',
            value: SEQUENCE_STATUSES.PAUSED,
            label: i18nLabel(msg`Paused`),
            position: 2,
            color: 'orange',
          },
        ],
      },
    }),
    senderConnectedAccountId: createStandardFieldFlatMetadata({
      ...args,
      context: {
        fieldName: 'senderConnectedAccountId',
        type: FieldMetadataType.UUID,
        label: i18nLabel(msg`Sender account`),
        description: i18nLabel(msg`Default connected account used to send`),
        icon: 'IconAt',
        isNullable: true,
      },
    }),
    settings: createStandardFieldFlatMetadata({
      ...args,
      context: {
        fieldName: 'settings',
        type: FieldMetadataType.RAW_JSON,
        label: i18nLabel(msg`Settings`),
        description: i18nLabel(msg`Sequence scheduling and delivery settings`),
        icon: 'IconSettings',
        isNullable: false,
        defaultValue: {
          activeDays: [1, 2, 3, 4, 5],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'UTC',
          dailyStarts: 25,
          staggerMinutes: 5,
          stopOnReply: true,
        },
      },
    }),
    enrolledCount: createCountField({
      fieldName: 'enrolledCount',
      label: i18nLabel(msg`Enrolled`),
      description: i18nLabel(msg`Number of enrolled people`),
    }),
    activeCount: createCountField({
      fieldName: 'activeCount',
      label: i18nLabel(msg`Active`),
      description: i18nLabel(msg`Number of active enrollments`),
    }),
    completedCount: createCountField({
      fieldName: 'completedCount',
      label: i18nLabel(msg`Completed`),
      description: i18nLabel(msg`Number of completed enrollments`),
    }),
    repliedCount: createCountField({
      fieldName: 'repliedCount',
      label: i18nLabel(msg`Replied`),
      description: i18nLabel(msg`Number of replied enrollments`),
    }),
    failedCount: createCountField({
      fieldName: 'failedCount',
      label: i18nLabel(msg`Failed`),
      description: i18nLabel(msg`Number of failed enrollments`),
    }),
    steps: createStandardRelationFieldFlatMetadata({
      ...args,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'steps',
        label: i18nLabel(msg`Steps`),
        description: i18nLabel(msg`Ordered steps in the sequence`),
        icon: 'IconListNumbers',
        isNullable: true,
        isUIEditable: false,
        targetObjectName: 'sequenceStep',
        targetFieldName: 'sequence',
        settings: { relationType: RelationType.ONE_TO_MANY },
      },
    }),
    enrollments: createStandardRelationFieldFlatMetadata({
      ...args,
      context: {
        type: FieldMetadataType.RELATION,
        morphId: null,
        fieldName: 'enrollments',
        label: i18nLabel(msg`Enrollments`),
        description: i18nLabel(msg`People enrolled in the sequence`),
        icon: 'IconUserCheck',
        isNullable: true,
        isUIEditable: false,
        targetObjectName: 'sequenceEnrollment',
        targetFieldName: 'sequence',
        settings: { relationType: RelationType.ONE_TO_MANY },
      },
    }),
  };
};
