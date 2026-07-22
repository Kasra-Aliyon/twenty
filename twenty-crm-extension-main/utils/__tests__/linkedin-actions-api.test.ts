import { describe, expect, it } from 'vitest';

import type { TwentyLinkedInAction } from '../../types';
import { applySkipIfAlreadyConnectedSettings } from '../linkedin-actions-api';

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
