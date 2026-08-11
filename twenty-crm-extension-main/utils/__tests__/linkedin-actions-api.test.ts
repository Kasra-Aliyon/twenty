import { describe, expect, it, vi } from 'vitest';

import type { TwentyLinkedInAction } from '../../types';
import {
  applySkipIfAlreadyConnectedSettings,
  reportAction,
} from '../linkedin-actions-api';
import type { TwentyApiClient } from '../twenty-api';

const buildAction = (sequenceStepId: string | null): TwentyLinkedInAction => ({
  id: 'action-id',
  type: 'SEND_CONNECTION_REQUEST',
  status: 'SCHEDULED',
  scheduledAt: '2026-07-22T12:00:00.000Z',
  claimedAt: null,
  linkedinUrl: 'https://www.linkedin.com/in/example/',
  noteText: '',
  connectionState: 'UNKNOWN',
  attemptCount: 0,
  errorMessage: null,
  sequenceStepId,
  skipIfAlreadyConnected: true,
});

describe('LinkedIn action sequence settings', () => {
  it('preserves an explicit false skip-if-connected setting', () => {
    const [action] = applySkipIfAlreadyConnectedSettings(
      [buildAction('step-id')],
      new Map([['step-id', false]]),
    );

    expect(action.skipIfAlreadyConnected).toBe(false);
  });

  it('defaults to the safe skip behavior when the step is unavailable', () => {
    const [action] = applySkipIfAlreadyConnectedSettings(
      [buildAction(null)],
      new Map(),
    );

    expect(action.skipIfAlreadyConnected).toBe(true);
  });
});

describe('LinkedIn action reporting', () => {
  it('reports only while the same runner still owns the claim', async () => {
    const completedAction = {
      ...buildAction('step-id'),
      status: 'COMPLETED' as const,
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
