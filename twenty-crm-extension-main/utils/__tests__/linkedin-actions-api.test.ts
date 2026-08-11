import { describe, expect, it, vi } from 'vitest';

import type { TwentyLinkedInAction } from '../../types';
import {
  claimAction,
  fetchDueActions,
  fetchLinkedinActionQueue,
  reportAction,
} from '../linkedin-actions-api';
import type { TwentyApiClient } from '../twenty-api';

const buildAction = (): TwentyLinkedInAction => ({
  id: 'action-id',
  type: 'SEND_CONNECTION_REQUEST',
  scheduledAt: '2026-07-22T12:00:00.000Z',
  claimedAt: null,
  linkedinUrl: 'https://www.linkedin.com/in/example/',
  noteText: '',
});

describe('LinkedIn action fetching', () => {
  it('fetches due actions with one request', async () => {
    const action = buildAction();
    const graphqlRequest = vi.fn().mockResolvedValue({
      data: { linkedinActions: { edges: [{ node: action }] } },
    });
    const client = { graphqlRequest } as unknown as TwentyApiClient;

    await expect(
      fetchDueActions(client, new Date('2026-07-22T12:00:00.000Z')),
    ).resolves.toEqual([action]);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
    expect(graphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('FetchDueLinkedinActions'),
      {
        filter: {
          scheduledAt: { lte: '2026-07-22T12:00:00.000Z' },
          status: { eq: 'SCHEDULED' },
        },
      },
    );
  });

  it('fetches the scheduled queue with one request', async () => {
    const action = buildAction();
    const graphqlRequest = vi.fn().mockResolvedValue({
      data: { linkedinActions: { edges: [{ node: action }] } },
    });
    const client = { graphqlRequest } as unknown as TwentyApiClient;

    await expect(fetchLinkedinActionQueue(client)).resolves.toEqual([action]);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
    expect(graphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('FetchLinkedinActionQueue'),
      { filter: { status: { eq: 'SCHEDULED' } } },
    );
  });

  it('claims an action with one request', async () => {
    const action = {
      ...buildAction(),
      claimedAt: '2026-07-22T12:01:00.000Z',
    };
    const graphqlRequest = vi.fn().mockResolvedValue({
      data: { updateLinkedinActions: [action] },
    });
    const client = { graphqlRequest } as unknown as TwentyApiClient;

    await expect(
      claimAction(client, 'action-id', 'extension-tab-42'),
    ).resolves.toEqual(action);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });
});

describe('LinkedIn action reporting', () => {
  it('reports only while the same runner still owns the claim', async () => {
    const completedAction = {
      ...buildAction(),
    };
    const graphqlRequest = vi.fn().mockResolvedValue({
      data: { updateLinkedinActions: [completedAction] },
    });
    const client = { graphqlRequest } as unknown as TwentyApiClient;

    await expect(
      reportAction(
        client,
        'action-id',
        'extension-tab-42',
        '2026-07-22T12:01:00.000Z',
        {
          status: 'COMPLETED',
          connectionState: 'PENDING',
        },
      ),
    ).resolves.toEqual(completedAction);
    expect(graphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('updateLinkedinActions'),
      expect.objectContaining({
        filter: {
          claimedAt: { eq: '2026-07-22T12:01:00.000Z' },
          claimedBy: { eq: 'extension-tab-42' },
          id: { eq: 'action-id' },
          status: { eq: 'CLAIMED' },
        },
      }),
    );
  });

  it('returns null for a stale result after the server releases the claim', async () => {
    const client = {
      graphqlRequest: vi.fn().mockResolvedValue({
        data: { updateLinkedinActions: [] },
      }),
    } as unknown as TwentyApiClient;

    await expect(
      reportAction(
        client,
        'action-id',
        'extension-tab-42',
        '2026-07-22T12:01:00.000Z',
        {
          status: 'COMPLETED',
          connectionState: 'PENDING',
        },
      ),
    ).resolves.toBeNull();
  });
});
