import { msg } from '@lingui/core/macro';
import { DateDisplayFormat, FieldMetadataType } from 'twenty-shared/types';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type AllStandardObjectFieldName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-field-name.type';
import { buildRecordListBaseStandardFlatFieldMetadatas } from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/build-record-list-base-standard-flat-field-metadatas.util';
import {
  type CreateStandardFieldArgs,
  createStandardFieldFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/create-standard-field-flat-metadata.util';
import { i18nLabel } from 'src/engine/workspace-manager/twenty-standard-application/utils/i18n-label.util';

export const buildLinkedinInvitationStandardFlatFieldMetadatas = (
  args: Omit<
    CreateStandardFieldArgs<'linkedinInvitation', FieldMetadataType>,
    'context'
  >,
): Record<
  AllStandardObjectFieldName<'linkedinInvitation'>,
  FlatFieldMetadata
> => ({
  ...buildRecordListBaseStandardFlatFieldMetadatas(args),
  externalId: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'externalId',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`External ID`),
      description: i18nLabel(msg`Stable owner-scoped LinkedIn invitation ID`),
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
        msg`Workspace member that owns this LinkedIn invitation`,
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
      description: i18nLabel(msg`LinkedIn invitation contact name`),
      icon: 'IconUser',
      isNullable: false,
      isUIEditable: false,
    },
  }),
  direction: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'direction',
      type: FieldMetadataType.SELECT,
      label: i18nLabel(msg`Direction`),
      description: i18nLabel(msg`LinkedIn invitation direction`),
      icon: 'IconArrowsExchange',
      isNullable: false,
      isUIEditable: false,
      options: [
        {
          id: '740961dc-52ab-4c45-aadb-01e74f36a502',
          value: 'SENT',
          label: i18nLabel(msg`Sent`),
          position: 0,
          color: 'blue',
        },
        {
          id: '9c9e2458-2140-4d07-8cc6-fa8263546e5f',
          value: 'RECEIVED',
          label: i18nLabel(msg`Received`),
          position: 1,
          color: 'green',
        },
      ],
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
  message: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'message',
      type: FieldMetadataType.TEXT,
      label: i18nLabel(msg`Message`),
      description: i18nLabel(msg`LinkedIn invitation note`),
      icon: 'IconMessage',
      isNullable: true,
      isUIEditable: false,
    },
  }),
  sentAt: createStandardFieldFlatMetadata({
    ...args,
    context: {
      fieldName: 'sentAt',
      type: FieldMetadataType.DATE_TIME,
      label: i18nLabel(msg`Sent at`),
      description: i18nLabel(msg`Time the LinkedIn invitation was sent`),
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
      description: i18nLabel(msg`LinkedIn member that owns the invitation`),
      icon: 'IconBrandLinkedin',
      isNullable: false,
      isUIEditable: false,
    },
  }),
});
