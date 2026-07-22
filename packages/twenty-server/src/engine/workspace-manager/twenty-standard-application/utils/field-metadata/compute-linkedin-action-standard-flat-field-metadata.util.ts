import { msg } from '@lingui/core/macro';
import {
  DateDisplayFormat,
  FieldMetadataType,
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
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

export const buildLinkedinActionStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'linkedinAction', FieldMetadataType>,
    'context'
  >,
): Record<AllStandardObjectFieldName<'linkedinAction'>, FlatFieldMetadata> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  type: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'type',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Type`),
      description: i18nLabel(msg`LinkedIn action type`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
      defaultValue: `'${LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST}'`,
      options: [
        {
          id: 'd7b5cb16-8c5b-471f-92be-f74542ec73c2',
          value: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
          label: i18nLabel(msg`Send connection request`),
          position: 0,
          color: 'blue',
        },
        {
          id: 'c3f8b62e-0cba-47c8-a3b8-a4abf77e5bf6',
          value: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
          label: i18nLabel(msg`Send message`),
          position: 1,
          color: 'purple',
        },
        {
          id: '5fd3e258-1549-40d2-8453-dc93e3d8ff1e',
          value: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
          label: i18nLabel(msg`Withdraw connection request`),
          position: 2,
          color: 'orange',
        },
      ],
    },
  }),
  status: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'status',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Status`),
      description: i18nLabel(msg`LinkedIn action status`),
      icon: 'IconStatusChange',
      isNullable: false,
      isUIEditable: false,
      defaultValue: `'${LINKEDIN_ACTION_STATUSES.SCHEDULED}'`,
      options: [
        {
          id: '81477dc6-113d-478d-87fd-5e511dc3fc4a',
          value: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          label: i18nLabel(msg`Scheduled`),
          position: 0,
          color: 'gray',
        },
        {
          id: '4c9c8dc1-b5e5-4ba1-a2a6-943a44db941b',
          value: LINKEDIN_ACTION_STATUSES.CLAIMED,
          label: i18nLabel(msg`Claimed`),
          position: 1,
          color: 'blue',
        },
        {
          id: 'c8cbb502-e976-426d-9aa9-b69f971e1e3e',
          value: LINKEDIN_ACTION_STATUSES.COMPLETED,
          label: i18nLabel(msg`Completed`),
          position: 2,
          color: 'green',
        },
        {
          id: '035b5c49-515a-42bc-8698-9ff6a644f377',
          value: LINKEDIN_ACTION_STATUSES.SKIPPED,
          label: i18nLabel(msg`Skipped`),
          position: 3,
          color: 'yellow',
        },
        {
          id: '213a0292-fed5-4075-893e-290429478778',
          value: LINKEDIN_ACTION_STATUSES.FAILED,
          label: i18nLabel(msg`Failed`),
          position: 4,
          color: 'red',
        },
        {
          id: '882ed900-2039-42aa-a173-58a3f08913df',
          value: LINKEDIN_ACTION_STATUSES.CANCELLED,
          label: i18nLabel(msg`Cancelled`),
          position: 5,
          color: 'gray',
        },
      ],
    },
  }),
  scheduledAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'scheduledAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Scheduled at`),
      description: i18nLabel(msg`Time when the browser may run the action`),
      icon: 'IconCalendarClock',
      isNullable: false,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  claimedAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'claimedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Claimed at`),
      description: i18nLabel(
        msg`Time when a browser runner claimed the action`,
      ),
      icon: 'IconHandStop',
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  claimedBy: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'claimedBy',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Claimed by`),
      description: i18nLabel(msg`Browser runner lease identifier`),
      icon: 'IconBrowser',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  executedAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'executedAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Executed at`),
      description: i18nLabel(msg`Time when the browser finished the action`),
      icon: 'IconPlayerPlay',
      isNullable: true,
      isUIEditable: false,
      settings: { displayFormat: DateDisplayFormat.RELATIVE },
    },
  }),
  attemptCount: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'attemptCount',
      type: FieldMetadataType.NUMBER,
      label: i18nLabel(msg`Attempt count`),
      description: i18nLabel(msg`Number of expired browser claims`),
      icon: 'IconRepeat',
      isNullable: false,
      isUIEditable: false,
      defaultValue: 0,
    },
  }),
  errorMessage: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'errorMessage',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Error`),
      description: i18nLabel(msg`Browser automation failure detail`),
      icon: 'IconAlertTriangle',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  linkedinUrl: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'linkedinUrl',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`LinkedIn URL`),
      description: i18nLabel(msg`Profile URL used by the browser runner`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  noteText: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'noteText',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Note`),
      description: i18nLabel(msg`Rendered connection note or direct message`),
      icon: 'IconNote',
      isNullable: false,
      isUIEditable: false,
      defaultValue: "''",
    },
  }),
  connectionState: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'connectionState',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Connection state`),
      description: i18nLabel(msg`Connection state observed by the browser`),
      icon: 'IconUserCheck',
      isNullable: false,
      isUIEditable: false,
      defaultValue: `'${LINKEDIN_CONNECTION_STATES.UNKNOWN}'`,
      options: [
        {
          id: 'aae43c8b-9bc6-453d-aba9-9425942f4401',
          value: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          label: i18nLabel(msg`Unknown`),
          position: 0,
          color: 'gray',
        },
        {
          id: '03db0e17-7be9-4305-933a-0e8fcbee9a13',
          value: LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
          label: i18nLabel(msg`Not connected`),
          position: 1,
          color: 'orange',
        },
        {
          id: '5ae1b528-14d8-4dfc-9d2a-02a956d1dc99',
          value: LINKEDIN_CONNECTION_STATES.PENDING,
          label: i18nLabel(msg`Pending`),
          position: 2,
          color: 'yellow',
        },
        {
          id: '36060df0-39e6-40e4-aedd-57aedbda6bcd',
          value: LINKEDIN_CONNECTION_STATES.CONNECTED,
          label: i18nLabel(msg`Connected`),
          position: 3,
          color: 'green',
        },
        {
          id: '4f281a3a-9868-4283-b103-52626bc50dab',
          value: LINKEDIN_CONNECTION_STATES.WITHDRAWN,
          label: i18nLabel(msg`Withdrawn`),
          position: 4,
          color: 'gray',
        },
      ],
    },
  }),
  person: createStandardRelationFieldFlatMetadata({
    ...args,
    context: {
      type: FieldMetadataType.RELATION,
      morphId: null,
      fieldName: 'person',
      label: i18nLabel(msg`Person`),
      description: i18nLabel(msg`Person targeted by this LinkedIn action`),
      icon: 'IconUser',
      isNullable: false,
      isUIEditable: false,
      targetObjectName: 'person',
      targetFieldName: 'linkedinActions',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'personId',
      },
    },
  }),
  sequenceEnrollmentId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'sequenceEnrollmentId',
      type: FieldMetadataType.UUID,
      label: i18nLabel(msg`Sequence enrollment`),
      description: i18nLabel(msg`Sequence enrollment that queued this action`),
      icon: 'IconSend',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  sequenceStepId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'sequenceStepId',
      type: FieldMetadataType.UUID,
      label: i18nLabel(msg`Sequence step`),
      description: i18nLabel(msg`Sequence step that queued this action`),
      icon: 'IconListNumbers',
      isNullable: true,
      isUIEditable: false,
    },
  }),
});
