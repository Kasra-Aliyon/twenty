import { describe, expect, it } from 'vitest';

import type {
  LinkedInRunnerSessionState,
  TwentyLinkedInAction,
} from '../../types';
import {
  canRecoverLinkedInActionAfterInterruption,
  getRunnerStateAfterTabRemoval,
} from '../linkedin-runner-state';

const action = { id: 'action-id' } as TwentyLinkedInAction;

const buildState = (
  overrides: Partial<LinkedInRunnerSessionState> = {},
): LinkedInRunnerSessionState => ({
  enabled: true,
  tabId: 42,
  activeAction: action,
  activeActionStartedAt: 100,
  lastExecutedAt: null,
  completedCount: 0,
  failedCount: 0,
  ...overrides,
});

describe('LinkedIn runner tab cleanup', () => {
  it('recovers idempotent invitation mutations but not direct messages', () => {
    expect(
      canRecoverLinkedInActionAfterInterruption('SEND_CONNECTION_REQUEST'),
    ).toBe(true);
    expect(
      canRecoverLinkedInActionAfterInterruption('WITHDRAW_CONNECTION_REQUEST'),
    ).toBe(true);
    expect(canRecoverLinkedInActionAfterInterruption('SEND_MESSAGE')).toBe(
      false,
    );
  });

  it('clears an interrupted action after its unknown outcome is reported', () => {
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState(),
        didReportInterruptedAction: true,
        now: 200,
      }),
    ).toEqual(
      expect.objectContaining({
        enabled: false,
        tabId: null,
        activeAction: null,
        activeActionStartedAt: null,
        lastExecutedAt: 200,
        failedCount: 1,
      }),
    );
  });

  it('preserves an unreported interrupted action for recovery in a new tab', () => {
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState(),
        didReportInterruptedAction: false,
      }),
    ).toEqual(
      expect.objectContaining({
        enabled: false,
        tabId: null,
        activeAction: action,
        activeActionStartedAt: 100,
      }),
    );
  });

  it('clears a claimed action that had not begun executing', () => {
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState({ activeActionStartedAt: null }),
        didReportInterruptedAction: false,
      }),
    ).toEqual(
      expect.objectContaining({
        activeAction: null,
        activeActionStartedAt: null,
      }),
    );
  });
});
