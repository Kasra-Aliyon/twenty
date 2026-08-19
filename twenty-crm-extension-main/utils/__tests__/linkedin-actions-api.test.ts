import { describe, expect, it, vi } from 'vitest';

import type { TwentyLinkedInAction } from '../../types';
import {
  claimAction,
  fetchDueActions,
  fetchLinkedinActionById,
  fetchLinkedinActionQueue,
  releaseActionClaim,
  reportAction,
  startActionClaim,
} from '../linkedin-actions-api';
import type { TwentyApiClient } from '../twenty-api';

const buildAction = (): TwentyLinkedInAction => ({
  id: 'action-id',
  type: 'SEND_CONNECTION_REQUEST',
  status: 'SCHEDULED',
  scheduledAt: '2026-07-22T12:00:00.000Z',
  claimedAt: null,
  claimedBy: null,
  executedAt: null,
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
        after: null,
        filter: {
          scheduledAt: { lte: '2026-07-22T12:00:00.000Z' },
          status: { eq: 'SCHEDULED' },
        },
      },
    );
  });

  it('paginates past a full stale page so later due work stays visible', async () => {
    const firstAction = buildAction();
    const secondAction = { ...buildAction(), id: 'second-action' };
    const graphqlRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          linkedinActions: {
            edges: [{ node: firstAction }],
            pageInfo: { hasNextPage: true, endCursor: 'page-2' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          linkedinActions: {
            edges: [{ node: secondAction }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    const client = { graphqlRequest } as unknown as TwentyApiClient;

    await expect(
      fetchDueActions(client, new Date('2026-07-22T12:00:00.000Z')),
    ).resolves.toEqual([firstAction, secondAction]);
    expect(graphqlRequest).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FetchDueLinkedinActions'),
      expect.objectContaining({ after: 'page-2' }),
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

  it('fetches one action by id for runner reconciliation', async () => {
    const action = {
      ...buildAction(),
      status: 'CLAIMED' as const,
      claimedAt: '2026-07-22T12:01:00.000Z',
      claimedBy: 'extension-tab-42',
    };
    const graphqlRequest = vi.fn().mockResolvedValue({
      data: { linkedinActions: { edges: [{ node: action }] } },
    });
    const client = { graphqlRequest } as unknown as TwentyApiClient;

    await expect(fetchLinkedinActionById(client, 'action-id')).resolves.toEqual(
      action,
    );
    expect(graphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('FetchLinkedinActionForReconciliation'),
      { filter: { id: { eq: 'action-id' } } },
    );
  });

  it('returns null when the reconciled action no longer exists', async () => {
    const client = {
      graphqlRequest: vi.fn().mockResolvedValue({
        data: { linkedinActions: { edges: [] } },
      }),
    } as unknown as TwentyApiClient;

    await expect(
      fetchLinkedinActionById(client, 'missing-action'),
    ).resolves.toBeNull();
  });

  it('claims an action with one request', async () => {
    const action = {
      ...buildAction(),
      claimedAt: '2026-07-22T12:01:00.000Z',
      claimedBy: 'extension-tab-42',
    };
    const metadataRequest = vi.fn().mockResolvedValue({
      data: { claimSequenceLinkedinAction: action },
    });
    const graphqlRequest = vi.fn();
    const client = {
      graphqlRequest,
      metadataRequest,
    } as unknown as TwentyApiClient;

    await expect(
      claimAction(client, 'action-id', 'extension-tab-42'),
    ).resolves.toEqual(action);
    expect(metadataRequest).toHaveBeenCalledTimes(1);
    expect(metadataRequest).toHaveBeenCalledWith(
      expect.stringContaining('claimSequenceLinkedinAction'),
      {
        actionId: 'action-id',
        claimedBy: 'extension-tab-42',
      },
    );
    expect(graphqlRequest).not.toHaveBeenCalled();
  });
});

describe('LinkedIn action claim release', () => {
  it('returns an unstarted claim to the queue with the original owner CAS', async () => {
    const releasedAction = buildAction();
    const metadataRequest = vi.fn().mockResolvedValue({
      data: { releaseSequenceLinkedinActionClaim: releasedAction },
    });
    const graphqlRequest = vi.fn();
    const client = {
      graphqlRequest,
      metadataRequest,
    } as unknown as TwentyApiClient;

    await expect(
      releaseActionClaim(
        client,
        'action-id',
        'extension-tab-42',
        '2026-07-22T12:01:00.000Z',
      ),
    ).resolves.toEqual(releasedAction);
    expect(metadataRequest).toHaveBeenCalledWith(
      expect.stringContaining('releaseSequenceLinkedinActionClaim'),
      {
        actionId: 'action-id',
        claimedAt: '2026-07-22T12:01:00.000Z',
        claimedBy: 'extension-tab-42',
      },
    );
    expect(graphqlRequest).not.toHaveBeenCalled();
  });
});

describe('LinkedIn action provider start', () => {
  it('atomically revalidates the stable claim immediately before provider start', async () => {
    const startedAction = {
      ...buildAction(),
      status: 'CLAIMED' as const,
      claimedAt: '2026-07-22T12:01:00.000Z',
      claimedBy: 'extension-tab-42',
      executedAt: '2026-07-22T12:09:30.000Z',
    };
    const metadataRequest = vi.fn().mockResolvedValue({
      data: { startSequenceLinkedinAction: startedAction },
    });
    const client = { metadataRequest } as unknown as TwentyApiClient;

    await expect(
      startActionClaim(
        client,
        'action-id',
        'extension-tab-42',
        '2026-07-22T12:01:00.000Z',
      ),
    ).resolves.toEqual(startedAction);
    expect(metadataRequest).toHaveBeenCalledWith(
      expect.stringContaining('startSequenceLinkedinAction'),
      {
        actionId: 'action-id',
        claimedAt: '2026-07-22T12:01:00.000Z',
        claimedBy: 'extension-tab-42',
      },
    );
  });

  it('returns null when the scheduler already terminalized the exact lease', async () => {
    const client = {
      metadataRequest: vi.fn().mockResolvedValue({
        data: { startSequenceLinkedinAction: null },
      }),
    } as unknown as TwentyApiClient;

    await expect(
      startActionClaim(
        client,
        'action-id',
        'extension-tab-42',
        '2026-07-22T12:01:00.000Z',
      ),
    ).resolves.toBeNull();
  });

  it('returns an explicit unclaimed scheduled result when start-time pacing re-slots the action', async () => {
    const rescheduledAction = {
      ...buildAction(),
      type: 'SEND_MESSAGE' as const,
      status: 'SCHEDULED' as const,
      scheduledAt: '2026-07-23T09:00:00.000Z',
      claimedAt: null,
      claimedBy: null,
      executedAt: null,
    };
    const client = {
      metadataRequest: vi.fn().mockResolvedValue({
        data: { startSequenceLinkedinAction: rescheduledAction },
      }),
    } as unknown as TwentyApiClient;

    await expect(
      startActionClaim(
        client,
        'action-id',
        'extension-tab-42',
        '2026-07-22T12:01:00.000Z',
      ),
    ).resolves.toEqual(rescheduledAction);
  });
});

describe('LinkedIn action reporting', () => {
  it('reports only while the same runner still owns the claim', async () => {
    const completedAction = {
      ...buildAction(),
    };
    const metadataRequest = vi.fn().mockResolvedValue({
      data: { reportSequenceLinkedinAction: completedAction },
    });
    const graphqlRequest = vi.fn();
    const client = {
      graphqlRequest,
      metadataRequest,
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
    ).resolves.toEqual(completedAction);
    expect(metadataRequest).toHaveBeenCalledWith(
      expect.stringContaining('reportSequenceLinkedinAction'),
      {
        actionId: 'action-id',
        claimedAt: '2026-07-22T12:01:00.000Z',
        claimedBy: 'extension-tab-42',
        data: {
          status: 'COMPLETED',
          connectionState: 'PENDING',
          errorMessage: null,
        },
      },
    );
    expect(graphqlRequest).not.toHaveBeenCalled();
  });

  it('returns null for a stale result after the server releases the claim', async () => {
    const client = {
      metadataRequest: vi.fn().mockResolvedValue({
        data: { reportSequenceLinkedinAction: null },
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
