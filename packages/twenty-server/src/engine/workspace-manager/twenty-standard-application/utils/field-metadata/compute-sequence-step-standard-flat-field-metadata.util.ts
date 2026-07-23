import { msg } from '@lingui/core/macro';
import {
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
  SEQUENCE_STEP_TYPES,
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

export const buildSequenceStepStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'sequenceStep', FieldMetadataType>,
    'context'
  >,
): Record<AllStandardObjectFieldName<'sequenceStep'>, FlatFieldMetadata> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  sequence: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'sequence',
      label: i18nLabel(msg`Sequence`),
      description: i18nLabel(msg`Sequence containing this step`),
      icon: 'IconSend',
      isNullable: false,
      isUIEditable: false,
      targetObjectName: 'sequence',
      targetFieldName: 'steps',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'sequenceId',
      },
    },
  }),
  name: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'name',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Name`),
      description: i18nLabel(msg`Optional step label`),
      icon: 'IconAbc',
      isNullable: true,
    },
  }),
  type: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'type',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Type`),
      description: i18nLabel(msg`Sequence step type`),
      icon: 'IconCategory',
      isNullable: false,
      defaultValue: `'${SEQUENCE_STEP_TYPES.SEND_EMAIL}'`,
      options: [
        {
          id: '83e60330-a2e3-492d-aa59-bc7e0cebde7b',
          value: SEQUENCE_STEP_TYPES.SEND_EMAIL,
          label: i18nLabel(msg`Send email`),
          position: 0,
          color: 'blue',
        },
        {
          id: 'd3baad64-8d98-4d25-9778-20e30438368e',
          value: SEQUENCE_STEP_TYPES.DELAY,
          label: i18nLabel(msg`Delay`),
          position: 1,
          color: 'orange',
        },
        {
          id: '7638ad18-be4d-4bf3-937b-e86cd2afd58e',
          value: SEQUENCE_STEP_TYPES.CREATE_TASK,
          label: i18nLabel(msg`Create task`),
          position: 2,
          color: 'purple',
        },
        {
          id: '201c6bf3-d49e-4a40-b271-b7301e5e2015',
          value: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
          label: i18nLabel(msg`Send connection request`),
          position: 3,
          color: 'blue',
        },
        {
          id: '1e668c0c-4b0e-47e2-9388-5906b58014ab',
          value: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
          label: i18nLabel(msg`Send LinkedIn message`),
          position: 4,
          color: 'purple',
        },
        {
          id: '0272b0a2-3d0e-489d-aaf9-28c238438dc8',
          value: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
          label: i18nLabel(msg`Withdraw connection request`),
          position: 5,
          color: 'orange',
        },
        {
          id: '40bbd9d6-82eb-40ca-b635-c607dcb1a9cf',
          value: SEQUENCE_STEP_TYPES.CONDITION,
          label: i18nLabel(msg`Condition`),
          position: 6,
          color: 'yellow',
        },
        {
          id: 'cd0aa6a2-a7e2-45e8-9ad9-ef005576d556',
          value: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
          label: i18nLabel(msg`Enrich phone number`),
          position: 7,
          color: 'green',
        },
      ],
    },
  }),
  settings: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'settings',
      type: FieldMetadataType.RAW_JSON,
      label: i18nLabel(msg`Settings`),
      description: i18nLabel(msg`Step-specific settings`),
      icon: 'IconSettings',
      isNullable: false,
      defaultValue: {
        type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
        subject: '',
        bodyHtml: '',
        threadAsReplyToPreviousEmail: false,
        stopOnReply: null,
      },
    },
  }),
});
