import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { linkedInVoyagerClient } from '../linkedin-voyager-client';

const STALE_SIGNATURE = 'messengerConversations.stale-scraped-id';
const BUILT_IN_SIGNATURE =
  'messengerConversations.8656fb361a8ad0c178e8d3ff1a84ce26';

const threadPage = (lastActivityAt: number) =>
  Response.json({
    data: {
      messengerConversationsByCategoryQuery: {
        elements: [{ entityUrn: 'urn:li:msg_conversation:1', lastActivityAt }],
        metadata: {},
      },
    },
  });

let values: Map<string, unknown>;
let fetchResponse: ReturnType<typeof vi.fn>;

const loadFirstPage = async () => {
  const pagePromise = linkedInVoyagerClient.fetchMessageThreadsPage('member', {
    cursor: null,
    updatedBefore: 2_000,
  });
  pagePromise.catch(() => undefined);

  // Requests are spaced by several seconds; let fake timers skip the waits.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await vi.advanceTimersByTimeAsync(15_000);
  }

  return pagePromise;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  values = new Map<string, unknown>([
    ['twentyLinkedinSignatureCache', { threads: STALE_SIGNATURE }],
  ]);
  fetchResponse = vi.fn();
  vi.stubGlobal('browser', {
    cookies: { get: vi.fn().mockResolvedValue({ value: '"session"' }) },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items))
            values.set(key, value);
        },
      },
    },
  });
  vi.stubGlobal('fetch', fetchResponse);
  await linkedInVoyagerClient.initialize(Date.now() + 10 * 60_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('falls back from a stale cached thread query that returns no inbox data and remembers the working one', async () => {
  fetchResponse.mockImplementation(async (url: string) =>
    url.includes(BUILT_IN_SIGNATURE) && url.includes('lastUpdatedBefore:2000')
      ? threadPage(1_500)
      : Response.json({
          data: { messengerConversationsByCategoryQuery: null },
        }),
  );

  const page = await loadFirstPage();

  expect(page.elements).toHaveLength(1);
  expect(page.threadPaginationMode).toBe('timestamp');
  expect(values.get('twentyLinkedinThreadQuery')).toEqual({
    signature: BUILT_IN_SIGNATURE,
    mode: 'timestamp',
  });

  fetchResponse.mockClear();
  await linkedInVoyagerClient.initialize(Date.now() + 10 * 60_000);
  await loadFirstPage();

  // The remembered query is tried first, so a healthy run costs one read.
  expect(fetchResponse).toHaveBeenCalledTimes(1);
  expect(fetchResponse.mock.calls[0]?.[0]).toContain(BUILT_IN_SIGNATURE);
});

it('surfaces LinkedIn GraphQL errors instead of treating them as an empty inbox', async () => {
  fetchResponse.mockImplementation(async () =>
    Response.json({ errors: [{ message: 'Unknown queryId' }], data: null }),
  );

  await expect(loadFirstPage()).rejects.toThrow(
    'LinkedIn rejected the message-thread query: Unknown queryId',
  );
});
