import {
  buildLinkedinActionEventDateFilter,
  buildLinkedinActionSearchFilter,
  buildLinkedinConnectionSearchFilter,
  buildLinkedinInvitationSearchFilter,
  buildLinkedinMessageSearchFilter,
  buildLinkedinParticipantSearchFilter,
  buildLinkedinThreadSearchFilter,
} from '../linkedin-search.utils.js';

const DATE_FROM = '2026-08-01T00:00:00.000Z';
const DATE_TO = '2026-08-13T23:59:59.000Z';

describe('LinkedIn MCP search filters', () => {
  it('builds message body, direction, thread, contact-thread, and date filters', () => {
    expect(
      buildLinkedinMessageSearchFilter(
        {
          search: 'publication plan',
          direction: 'OUTBOUND',
          thread_id: 'thread-1',
          date_from: DATE_FROM,
          date_to: DATE_TO,
        },
        ['thread-1', 'thread-2'],
      ),
    ).toBe(
      'and(or(body[ilike]:"%publication plan%",senderName[ilike]:"%publication plan%"),direction[eq]:"OUTBOUND",threadId[eq]:"thread-1",threadId[in]:["thread-1","thread-2"],and(deliveredAt[gte]:"2026-08-01T00:00:00.000Z",deliveredAt[lte]:"2026-08-13T23:59:59.000Z"))',
    );
  });

  it('builds conversation-span filters for threads', () => {
    expect(
      buildLinkedinThreadSearchFilter({
        search: 'systematic review',
        contact: 'Katrin',
        date_from: DATE_FROM,
        date_to: DATE_TO,
      }),
    ).toBe(
      'and(or(name[ilike]:"%systematic review%",lastMessagePreview[ilike]:"%systematic review%"),name[ilike]:"%Katrin%",lastMessageTime[gte]:"2026-08-01T00:00:00.000Z",firstMessageTime[lte]:"2026-08-13T23:59:59.000Z")',
    );
  });

  it('searches connection identity fields plus matched person and time', () => {
    const filter = buildLinkedinConnectionSearchFilter({
      search: 'medical writer',
      contact: 'linkedin.com/in/katrin',
      person_id: 'person-1',
      date_from: DATE_FROM,
      date_to: DATE_TO,
    });

    expect(filter).toContain('headline[ilike]:"%medical writer%"');
    expect(filter).toContain(
      'profileUrl.primaryLinkUrl[ilike]:"%linkedin.com/in/katrin%"',
    );
    expect(filter).toContain('personId[eq]:"person-1"');
    expect(filter).toContain('connectedAt[gte]');
    expect(filter).toContain('connectedAt[lte]');
  });

  it('searches invitation contact/note text, direction, and sent time', () => {
    const filter = buildLinkedinInvitationSearchFilter({
      search: 'manuscript',
      contact: 'Katrin',
      direction: 'SENT',
      date_from: DATE_FROM,
      date_to: DATE_TO,
    });

    expect(filter).toContain('message[ilike]:"%manuscript%"');
    expect(filter).toContain('name[ilike]:"%Katrin%"');
    expect(filter).toContain('direction[eq]:"SENT"');
    expect(filter).toContain('sentAt[gte]');
    expect(filter).toContain('sentAt[lte]');
  });

  it('searches participant identities and relations', () => {
    const filter = buildLinkedinParticipantSearchFilter({
      search: 'Katrin',
      person_id: 'person-1',
      thread_id: 'thread-1',
      is_self: false,
    });

    expect(filter).toContain('name[ilike]:"%Katrin%"');
    expect(filter).toContain('profileUrl.primaryLinkUrl[ilike]:"%Katrin%"');
    expect(filter).toContain('personId[eq]:"person-1"');
    expect(filter).toContain('threadId[eq]:"thread-1"');
    expect(filter).toContain('isSelf[eq]:false');
  });

  it('searches actions by target, execution state, and selected date field', () => {
    const filter = buildLinkedinActionSearchFilter({
      search: 'connection-send-2',
      contact: 'linkedin.com/in/katrin',
      person_id: 'person-1',
      type: 'SEND_CONNECTION_REQUEST',
      status: 'FAILED',
      connection_state: 'NOT_CONNECTED',
      date_field: 'executed',
      date_from: DATE_FROM,
      date_to: DATE_TO,
    });

    expect(filter).toContain('errorMessage[ilike]:"%connection-send-2%"');
    expect(filter).toContain('linkedinUrl[ilike]:"%linkedin.com/in/katrin%"');
    expect(filter).toContain('type[eq]:"SEND_CONNECTION_REQUEST"');
    expect(filter).toContain('status[eq]:"FAILED"');
    expect(filter).toContain('connectionState[eq]:"NOT_CONNECTED"');
    expect(filter).toContain('executedAt[gte]');
    expect(filter).toContain('executedAt[lte]');
  });

  it('uses executed time or scheduled fallback for cross-source activity', () => {
    expect(
      buildLinkedinActionEventDateFilter({
        date_from: DATE_FROM,
        date_to: DATE_TO,
      }),
    ).toBe(
      'or(and(executedAt[gte]:"2026-08-01T00:00:00.000Z",executedAt[lte]:"2026-08-13T23:59:59.000Z"),and(executedAt[is]:NULL,and(scheduledAt[gte]:"2026-08-01T00:00:00.000Z",scheduledAt[lte]:"2026-08-13T23:59:59.000Z")))',
    );
  });

  it('rejects reversed date ranges', () => {
    expect(() =>
      buildLinkedinMessageSearchFilter({
        date_from: DATE_TO,
        date_to: DATE_FROM,
      }),
    ).toThrow('date_from must be earlier than or equal to date_to');
  });
});
