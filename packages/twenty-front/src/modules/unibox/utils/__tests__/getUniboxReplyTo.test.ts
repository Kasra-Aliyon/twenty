import { getUniboxReplyTo } from '@/unibox/utils/getUniboxReplyTo';

describe('getUniboxReplyTo', () => {
  it('uses the most recent external sender when the last message is outbound', () => {
    expect(
      getUniboxReplyTo({
        messages: [
          {
            sender: {
              handle: 'contact@example.com',
              workspaceMember: null,
            },
          },
          {
            sender: {
              handle: 'owner@example.com',
              workspaceMember: { id: 'workspace-member-id' },
            },
          },
        ],
        connectedAccountHandle: 'owner@example.com',
        fallbackHandle: 'fallback@example.com',
      }),
    ).toBe('contact@example.com');
  });

  it('excludes the connected account even when sender ownership is missing', () => {
    expect(
      getUniboxReplyTo({
        messages: [
          { sender: { handle: 'contact@example.com' } },
          { sender: { handle: 'OWNER@example.com' } },
        ],
        connectedAccountHandle: 'owner@example.com',
        fallbackHandle: 'fallback@example.com',
      }),
    ).toBe('contact@example.com');
  });

  it('falls back to the thread counterpart when no external sender is loaded', () => {
    expect(
      getUniboxReplyTo({
        messages: [
          {
            sender: {
              handle: 'owner@example.com',
              workspaceMember: { id: 'workspace-member-id' },
            },
          },
        ],
        connectedAccountHandle: 'owner@example.com',
        fallbackHandle: 'fallback@example.com',
      }),
    ).toBe('fallback@example.com');
  });
});
