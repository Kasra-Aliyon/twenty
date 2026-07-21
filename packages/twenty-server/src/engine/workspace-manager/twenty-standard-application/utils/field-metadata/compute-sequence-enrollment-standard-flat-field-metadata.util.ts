import { msg } from '@lingui/core/macro';
import {
  DateDisplayFormat,
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
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

export const buildSequenceEnrollmentStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'sequenceEnrollment', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'sequenceEnrollment'>,
  FlatFieldMetadata
> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  sequence: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'sequence',
      label: i18nLabel(msg`Sequence`),
      description: i18nLabel(msg`Sequence for this enrollment`),
      icon: 'IconSend',
      isNullable: false,
      isUIEditable: false,
      targetObjectName: 'sequence',
      targetFieldName: 'enrollments',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'sequenceId',
      },
    },
  }),
  person: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'person',
      label: i18nLabel(msg`Person`),
      description: i18nLabel(msg`Person enrolled in the sequence`),
      icon: 'IconUser',
      isNullable: false,
      isUIEditable: false,
      targetObjectName: 'person',
      targetFieldName: 'sequenceEnrollments',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'personId',
      },
    },
  }),
  status: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'status',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Status`),
      description: i18nLabel(msg`Enrollment status`),
      icon: 'IconStatusChange',
      isNullable: false,
      defaultValue: `'${SEQUENCE_ENROLLMENT_STATUSES.PENDING}'`,
      options: [
        {
          id: '59607edc-db06-44b3-9a0b-d758b6cfcf65',
          value: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
          label: i18nLabel(msg`Pending`),
          position: 0,
          color: 'gray',
        },
        {
          id: '2efbdd72-05ed-4005-a10e-0003a2a161da',
          value: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          label: i18nLabel(msg`Active`),
          position: 1,
          color: 'blue',
        },
        {
          id: '9414a259-798a-48a3-8242-5c5b263bc960',
          value: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
          label: i18nLabel(msg`Completed`),
          position: 2,
          color: 'green',
        },
        {
          id: 'c863834e-1551-497a-a8c1-8015708acedc',
          value: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          label: i18nLabel(msg`Replied`),
          position: 3,
          color: 'purple',
        },
        {
          id: '7bc7bda0-168e-4572-bc2f-9cca83614cbe',
          value: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
          label: i18nLabel(msg`Failed`),
          position: 4,
          color: 'red',
        },
        {
          id: '43b25681-4cbc-447e-8c50-1e85706075f7',
          value: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
          label: i18nLabel(msg`Removed`),
          position: 5,
          color: 'gray',
        },
      ],
    },
  }),
  currentStepId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'currentStepId',
      type: FieldMetadataType.UUID,
      label: i18nLabel(msg`Current step`),
      description: i18nLabel(msg`Current sequence step identifier`),
      icon: 'IconListNumbers',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  currentStepPosition: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'currentStepPosition',
      type: FieldMetadataType.NUMBER,
      label: i18nLabel(msg`Current step position`),
      description: i18nLabel(msg`Sequence engine cursor`),
      icon: 'IconListNumbers',
      isNullable: false,
      isUIEditable: false,
      defaultValue: -1,
    },
  }),
  waitingOn: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'waitingOn',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Waiting on`),
      description: i18nLabel(msg`Condition blocking sequence progress`),
      icon: 'IconClock',
      isNullable: true,
      isUIEditable: false,
      options: [
        {
          id: '28665cc6-52bd-44d0-8604-32a87de77047',
          value: SEQUENCE_WAITING_ON.DELAY,
          label: i18nLabel(msg`Delay`),
          position: 0,
          color: 'orange',
        },
        {
          id: '63f94471-2b25-4466-98ef-fcb577dda72b',
          value: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          label: i18nLabel(msg`Email scheduled`),
          position: 1,
          color: 'blue',
        },
        {
          id: 'aebf49d7-2ad9-4a4e-8977-fc500804c7a0',
          value: SEQUENCE_WAITING_ON.TASK_DONE,
          label: i18nLabel(msg`Task completion`),
          position: 2,
          color: 'purple',
        },
        {
          id: '6abb7bf0-4409-4dfa-b8a9-6c98f632f363',
          value: SEQUENCE_WAITING_ON.TASK_DEADLINE,
          label: i18nLabel(msg`Task deadline`),
          position: 3,
          color: 'red',
        },
      ],
    },
  }),
  nextActionAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'nextActionAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Next action`),
      description: i18nLabel(msg`Time of the next sequence action`),
      icon: 'IconCalendarClock',
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  senderConnectedAccountId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'senderConnectedAccountId',
      type: FieldMetadataType.UUID,
      label: i18nLabel(msg`Sender account`),
      description: i18nLabel(msg`Connected account used for this enrollment`),
      icon: 'IconAt',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  stopOnReply: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'stopOnReply',
      type: FieldMetadataType.BOOLEAN,
      label: i18nLabel(msg`Stop on reply`),
      description: i18nLabel(msg`Stop this enrollment when the person replies`),
      icon: 'IconMessageOff',
      isNullable: false,
      defaultValue: true,
    },
  }),
  startedAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'startedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Started at`),
      description: i18nLabel(msg`Time the enrollment became active`),
      icon: 'IconPlayerPlay',
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  endedAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'endedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Ended at`),
      description: i18nLabel(msg`Time the enrollment ended`),
      icon: 'IconPlayerStop',
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  errorMessage: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'errorMessage',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Error`),
      description: i18nLabel(msg`Sequence processing failure detail`),
      icon: 'IconAlertTriangle',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  sentEmailsByStepId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'sentEmailsByStepId',
      type: FieldMetadataType.RAW_JSON,
      label: i18nLabel(msg`Sent emails by step`),
      description: i18nLabel(msg`Sent email threading and audit metadata`),
      icon: 'IconMailCheck',
      isNullable: false,
      isUIEditable: false,
      defaultValue: {},
    },
  }),
  lastSendAttempt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'lastSendAttempt',
      type: FieldMetadataType.RAW_JSON,
      label: i18nLabel(msg`Last send attempt`),
      description: i18nLabel(msg`Most recent email send claim metadata`),
      icon: 'IconMailForward',
      isNullable: true,
      isUIEditable: false,
    },
  }),
});
