import { describe, expect, it, vi } from 'vitest';

import type { GraphQLResponse } from '../../types';
import {
  handleLinkedInHarvestStoreRequest,
  type LinkedInThreadWriteResult,
} from '../linkedin-harvest-store';
import type { TwentyApiClient } from '../twenty-api';

const createClient = (responses: GraphQLResponse<unknown>[]) => {
  const graphqlRequest = vi.fn(
    async (
      _query: string,
      _variables?: Record<string, unknown>,
    ): Promise<GraphQLResponse<unknown>> => responses.shift() ?? {},
  );

  return {
    client: { graphqlRequest } as unknown as TwentyApiClient,
    graphqlRequest,
  };
};

const getWrittenData = (
  graphqlRequest: ReturnType<typeof createClient>['graphqlRequest'],
): Record<string, unknown> => {
  const variables = graphqlRequest.mock.calls[0]?.[1];
  const data = variables?.data;

  if (!Array.isArray(data) || !data[0]) {
    throw new Error('Expected the store to write one record');
  }

  return data[0] as Record<string, unknown>;
};

describe('LinkedIn harvest standard object writes', () => {
  it('persists the connection LinkedIn URN used for participant matching', async () => {
    const { client, graphqlRequest } = createClient([
      {
        data: {
          createLinkedinConnections: [
            {
              id: 'connection-id',
              externalId: 'owner-id:profile-urn',
              createdAt: '2026-07-22T10:00:00.000Z',
            },
          ],
        },
      },
    ]);

    await handleLinkedInHarvestStoreRequest(client, {
      action: 'WRITE_CONNECTIONS',
      ownerLinkedinId: 'owner-id',
      runStartedAt: new Date('2026-07-22T09:00:00.000Z').getTime(),
      records: [
        {
          profileUrn: 'profile-urn',
          linkedinUrn: 'profile-urn',
          linkedinId: 'member-id',
          handle: 'ada-lovelace',
          name: 'Ada Lovelace',
          headline: 'Mathematician',
          profileUrl: 'https://www.linkedin.com/in/ada-lovelace/',
          connectedAt: '2026-07-20T10:00:00.000Z',
        },
      ],
    });

    expect(getWrittenData(graphqlRequest)).toMatchObject({
      externalId: 'owner-id:profile-urn',
      linkedinUrn: 'profile-urn',
      ownerLinkedinId: 'owner-id',
    });
  });

  it('returns the Twenty thread id without writing participants as JSON', async () => {
    const { client, graphqlRequest } = createClient([
      {
        data: {
          createLinkedinMessageThreads: [
            {
              id: 'twenty-thread-id',
              externalId: 'owner-id:linkedin-thread-id',
              createdAt: '2026-07-22T10:00:00.000Z',
            },
          ],
        },
      },
    ]);

    const result = (await handleLinkedInHarvestStoreRequest(client, {
      action: 'WRITE_THREADS',
      ownerLinkedinId: 'owner-id',
      records: [
        {
          threadId: 'linkedin-thread-id',
          name: 'Ada Lovelace',
          firstMessageTime: '2026-07-21T10:00:00.000Z',
          lastMessageTime: '2026-07-22T10:00:00.000Z',
          labels: ['inbox'],
          participants: [
            {
              linkedinId: 'member-id',
              linkedinUrn: 'profile-urn',
              name: 'Ada Lovelace',
              headline: 'Mathematician',
              handle: 'ada-lovelace',
              profileUrl: 'https://www.linkedin.com/in/ada-lovelace/',
              isSelf: false,
            },
          ],
        },
      ],
    })) as LinkedInThreadWriteResult;
    const writtenData = getWrittenData(graphqlRequest);

    expect(result.writtenThreads).toEqual([
      {
        id: 'twenty-thread-id',
        externalId: 'owner-id:linkedin-thread-id',
      },
    ]);
    expect(writtenData).not.toHaveProperty('participants');
    expect(writtenData).toMatchObject({
      externalId: 'owner-id:linkedin-thread-id',
      threadId: 'linkedin-thread-id',
      ownerLinkedinId: 'owner-id',
    });
  });

  it('writes one participant row related by the Twenty thread id', async () => {
    const { client, graphqlRequest } = createClient([
      {
        data: {
          createLinkedinThreadParticipants: [
            {
              id: 'participant-id',
              externalId: 'owner-id:linkedin-thread-id:profile-urn',
              createdAt: '2026-07-22T10:00:00.000Z',
            },
          ],
        },
      },
    ]);

    await handleLinkedInHarvestStoreRequest(client, {
      action: 'WRITE_THREAD_PARTICIPANTS',
      ownerLinkedinId: 'owner-id',
      records: [
        {
          sourceThreadId: 'linkedin-thread-id',
          threadId: 'twenty-thread-id',
          linkedinId: 'member-id',
          linkedinUrn: 'profile-urn',
          name: 'Ada Lovelace',
          headline: 'Mathematician',
          handle: 'ada-lovelace',
          profileUrl: 'https://www.linkedin.com/in/ada-lovelace/',
          isSelf: false,
        },
      ],
    });

    expect(getWrittenData(graphqlRequest)).toMatchObject({
      externalId: 'owner-id:linkedin-thread-id:profile-urn',
      linkedinMemberId: 'member-id',
      linkedinUrn: 'profile-urn',
      threadId: 'twenty-thread-id',
      profileUrl: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
      },
    });
  });

  it('writes messages with the thread relation and sender LinkedIn URN', async () => {
    const { client, graphqlRequest } = createClient([
      {
        data: {
          createLinkedinMessages: [
            {
              id: 'message-id',
              externalId: 'owner-id:linkedin-message-id',
              createdAt: '2026-07-22T10:00:00.000Z',
            },
          ],
        },
      },
    ]);

    await handleLinkedInHarvestStoreRequest(client, {
      action: 'WRITE_MESSAGES',
      ownerLinkedinId: 'owner-id',
      records: [
        {
          messageId: 'linkedin-message-id',
          threadId: 'twenty-thread-id',
          body: 'Hello from LinkedIn',
          deliveredAt: '2026-07-22T10:00:00.000Z',
          direction: 'INBOUND',
          senderName: 'Ada Lovelace',
          senderLinkedinUrn: 'profile-urn',
        },
      ],
    });
    const writtenData = getWrittenData(graphqlRequest);

    expect(writtenData).toMatchObject({
      externalId: 'owner-id:linkedin-message-id',
      senderLinkedinUrn: 'profile-urn',
      threadId: 'twenty-thread-id',
    });
    expect(writtenData).not.toHaveProperty('threadExternalId');
    expect(writtenData).not.toHaveProperty('senderHandle');
  });

  it('recomputes the thread preview and count from related messages', async () => {
    const { client, graphqlRequest } = createClient([
      {
        data: {
          linkedinMessages: {
            edges: [{ node: { body: `  ${'x'.repeat(220)}  ` } }],
            totalCount: 12,
          },
        },
      },
      {
        data: { updateLinkedinMessageThread: { id: 'twenty-thread-id' } },
      },
    ]);

    const result = await handleLinkedInHarvestStoreRequest(client, {
      action: 'UPDATE_THREAD_SUMMARY',
      threadId: 'twenty-thread-id',
    });

    expect(result).toEqual({
      lastMessagePreview: 'x'.repeat(200),
      messageCount: 12,
    });
    expect(graphqlRequest.mock.calls[1]?.[1]).toEqual({
      id: 'twenty-thread-id',
      data: {
        lastMessagePreview: 'x'.repeat(200),
        messageCount: 12,
      },
    });
  });
});
