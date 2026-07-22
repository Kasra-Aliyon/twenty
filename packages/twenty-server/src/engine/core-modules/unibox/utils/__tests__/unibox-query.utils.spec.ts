import { MessageParticipantRole } from 'twenty-shared/types';

import { UniboxContactCrmFilter } from 'src/engine/core-modules/unibox/enums/unibox-contact-crm-filter.enum';
import { UniboxContactSince } from 'src/engine/core-modules/unibox/enums/unibox-contact-since.enum';
import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';
import {
  getUniboxContactCrmHavingClause,
  getUniboxContactsSinceDate,
  getUniboxEmailFolderQueryConfig,
  getUniboxPageOffset,
  normalizeUniboxContactHandles,
} from 'src/engine/core-modules/unibox/utils/unibox-query.utils';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';

describe('Unibox query utilities', () => {
  it('should map Inbox and Sent to disjoint latest-message directions', () => {
    expect(getUniboxEmailFolderQueryConfig(UniboxFolder.INBOX)).toEqual({
      counterpartRoles: [MessageParticipantRole.FROM],
      direction: MessageDirection.INCOMING,
    });
    expect(getUniboxEmailFolderQueryConfig(UniboxFolder.SENT)).toEqual({
      counterpartRoles: [
        MessageParticipantRole.TO,
        MessageParticipantRole.CC,
        MessageParticipantRole.BCC,
      ],
      direction: MessageDirection.OUTGOING,
    });
  });

  it('should compute zero-based offsets at pagination boundaries', () => {
    expect(getUniboxPageOffset(1, 30)).toBe(0);
    expect(getUniboxPageOffset(2, 30)).toBe(30);
    expect(getUniboxPageOffset(3, 100)).toBe(200);
  });

  it('should normalize and deduplicate contact handles', () => {
    expect(
      normalizeUniboxContactHandles([
        ' Person@Example.com ',
        'person@example.com',
        '',
        ' SECOND@example.com ',
      ]),
    ).toEqual(['person@example.com', 'second@example.com']);
  });

  it('should calculate deterministic contact windows', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');

    expect(
      getUniboxContactsSinceDate(UniboxContactSince.LIFETIME, now),
    ).toBeNull();
    expect(
      getUniboxContactsSinceDate(UniboxContactSince.LAST_YEAR, now),
    ).toEqual(new Date('2025-07-22T12:00:00.000Z'));
    expect(
      getUniboxContactsSinceDate(UniboxContactSince.LAST_90_DAYS, now),
    ).toEqual(new Date('2026-04-23T12:00:00.000Z'));
    expect(
      getUniboxContactsSinceDate(UniboxContactSince.LAST_30_DAYS, now),
    ).toEqual(new Date('2026-06-22T12:00:00.000Z'));
  });

  it('should provide CRM HAVING clauses only for constrained filters', () => {
    expect(getUniboxContactCrmHavingClause(UniboxContactCrmFilter.IN_CRM)).toBe(
      'BOOL_OR("messageParticipant"."personId" IS NOT NULL)',
    );
    expect(
      getUniboxContactCrmHavingClause(UniboxContactCrmFilter.NOT_IN_CRM),
    ).toBe('NOT BOOL_OR("messageParticipant"."personId" IS NOT NULL)');
    expect(
      getUniboxContactCrmHavingClause(UniboxContactCrmFilter.ALL),
    ).toBeNull();
  });
});
