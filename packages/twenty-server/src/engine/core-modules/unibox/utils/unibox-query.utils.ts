import { MessageParticipantRole } from 'twenty-shared/types';

import { UniboxContactCrmFilter } from 'src/engine/core-modules/unibox/enums/unibox-contact-crm-filter.enum';
import { UniboxContactSince } from 'src/engine/core-modules/unibox/enums/unibox-contact-since.enum';
import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';

export const getUniboxEmailFolderQueryConfig = (
  folder: UniboxFolder.INBOX | UniboxFolder.SENT,
): {
  counterpartRoles: MessageParticipantRole[];
  direction: MessageDirection;
} => {
  if (folder === UniboxFolder.INBOX) {
    return {
      counterpartRoles: [MessageParticipantRole.FROM],
      direction: MessageDirection.INCOMING,
    };
  }

  return {
    counterpartRoles: [
      MessageParticipantRole.TO,
      MessageParticipantRole.CC,
      MessageParticipantRole.BCC,
    ],
    direction: MessageDirection.OUTGOING,
  };
};

export const getUniboxPageOffset = (page: number, pageSize: number): number =>
  (page - 1) * pageSize;

export const normalizeUniboxContactHandles = (handles: string[]): string[] => [
  ...new Set(
    handles
      .map((handle) => handle.trim().toLowerCase())
      .filter((handle) => handle.length > 0),
  ),
];

export const getUniboxContactsSinceDate = (
  since: UniboxContactSince,
  now = new Date(),
): Date | null => {
  switch (since) {
    case UniboxContactSince.LAST_YEAR: {
      const lastYear = new Date(now);

      lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 1);

      return lastYear;
    }
    case UniboxContactSince.LAST_90_DAYS:
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case UniboxContactSince.LAST_30_DAYS:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case UniboxContactSince.LIFETIME:
      return null;
  }
};

export const getUniboxContactCrmHavingClause = (
  filter: UniboxContactCrmFilter,
): string | null => {
  if (filter === UniboxContactCrmFilter.IN_CRM) {
    return 'BOOL_OR("messageParticipant"."personId" IS NOT NULL)';
  }

  if (filter === UniboxContactCrmFilter.NOT_IN_CRM) {
    return 'NOT BOOL_OR("messageParticipant"."personId" IS NOT NULL)';
  }

  return null;
};
