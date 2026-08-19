import { describe, expect, it, vi } from 'vitest';

import type {
  LinkedInRunnerSessionState,
  TwentyLinkedInAction,
} from '../../types';
import {
  canStartClaimedLinkedinAction,
  canRecoverLinkedInActionAfterInterruption,
  claimFirstAvailableLinkedinAction,
  createSerializedLinkedinRunnerOperation,
  getLinkedinRunnerActionOwnershipError,
  getLinkedinRunnerClaimError,
  getLinkedinRunnerEnableError,
  getRunnerStateAfterPause,
  getRunnerStateAfterTabRemoval,
  invokeLinkedinProviderOperationAfterStart,
  LINKEDIN_ACTION_REPORT_CONFLICT_ERROR,
  LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
  LINKEDIN_ACTION_RECONCILIATION_FETCH_ERROR,
  LINKEDIN_RUNNER_ACTIVE_ACTION_ERROR,
  LINKEDIN_RUNNER_ALREADY_OWNED_ERROR,
  LINKEDIN_RUNNER_NOT_OWNED_ERROR,
  reconcileRunnerActionOnEnable,
  reconcileRunnerActionWithServer,
  reconcileRunnerReleaseOnEnable,
  reconcileRunnerReleaseWithServer,
  releaseRunnerActionBeforeProviderStart,
  resolveRunnerActionReport,
  resolveRunnerProviderStart,
  waitForLinkedinProviderStartAuthorization,
} from '../linkedin-runner-state';

const action = {
  id: 'action-id',
  type: 'SEND_CONNECTION_REQUEST',
  status: 'CLAIMED',
  claimedAt: '2026-08-17T10:00:00.000Z',
  claimedBy: 'extension-tab-42',
} as TwentyLinkedInAction;

const buildState = (
  overrides: Partial<LinkedInRunnerSessionState> = {},
): LinkedInRunnerSessionState => ({
  enabled: true,
  tabId: 42,
  activeAction: action,
  activeActionStartedAt: 100,
  activeActionNeedsRelease: false,
  activeActionNeedsReconciliation: false,
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
        reportedInterruptedAction: action,
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
        reportedInterruptedAction: null,
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
        reportedInterruptedAction: null,
        unstartedClaimHandled: true,
      }),
    ).toEqual(
      expect.objectContaining({
        activeAction: null,
        activeActionStartedAt: null,
      }),
    );
  });

  it('keeps an unstarted claim when its release could not be confirmed', () => {
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState({ activeActionStartedAt: null }),
        reportedInterruptedAction: null,
      }),
    ).toEqual(
      expect.objectContaining({
        activeAction: action,
        activeActionStartedAt: null,
        activeActionNeedsRelease: true,
      }),
    );
  });

  it('preserves a direct-message conflict only for outcome reconciliation', () => {
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState({
          activeAction: { ...action, type: 'SEND_MESSAGE' },
        }),
        reportedInterruptedAction: null,
      }),
    ).toEqual(
      expect.objectContaining({
        activeAction: expect.objectContaining({ type: 'SEND_MESSAGE' }),
        activeActionStartedAt: 100,
      }),
    );
  });

  it('preserves a tab-removal outcome rejected after the claim lease expired', () => {
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState({ failedCount: 2 }),
        reportedInterruptedAction: null,
        now: 200,
      }),
    ).toEqual(
      expect.objectContaining({
        activeAction: action,
        activeActionStartedAt: 100,
        lastExecutedAt: null,
        failedCount: 2,
      }),
    );
  });
});

describe('LinkedIn runner queue claims', () => {
  it('continues past an unclaimable due row to the next available action', async () => {
    const secondAction = { ...action, id: 'second-action' };
    const claim = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(secondAction);

    await expect(
      claimFirstAvailableLinkedinAction([action, secondAction], claim),
    ).resolves.toEqual(secondAction);
    expect(claim).toHaveBeenNthCalledWith(1, action);
    expect(claim).toHaveBeenNthCalledWith(2, secondAction);
  });

  it('rejects a claim from a tab that does not own the enabled runner', () => {
    expect(
      getLinkedinRunnerClaimError(
        buildState({ activeAction: null, activeActionStartedAt: null }),
        43,
      ),
    ).toBe(LINKEDIN_RUNNER_NOT_OWNED_ERROR);
  });

  it('serializes concurrent claim attempts across the remote claim await', async () => {
    const serialize = createSerializedLinkedinRunnerOperation();
    let runnerState = buildState({
      activeAction: null,
      activeActionStartedAt: null,
    });
    let continueFirstClaim: (() => void) | undefined;
    let markFirstClaimStarted: (() => void) | undefined;
    const firstClaimStarted = new Promise<void>((resolve) => {
      markFirstClaimStarted = resolve;
    });
    const firstClaimCanFinish = new Promise<void>((resolve) => {
      continueFirstClaim = resolve;
    });

    const attemptClaim = (
      nextAction: TwentyLinkedInAction,
      waitForRemoteClaim = false,
    ) =>
      serialize(async () => {
        const claimError = getLinkedinRunnerClaimError(runnerState, 42);

        if (claimError) {
          return claimError;
        }

        if (waitForRemoteClaim) {
          markFirstClaimStarted?.();
          await firstClaimCanFinish;
        }

        runnerState = { ...runnerState, activeAction: nextAction };

        return nextAction.id;
      });

    const firstClaim = attemptClaim(action, true);

    await firstClaimStarted;

    const secondClaim = attemptClaim({ ...action, id: 'second-action' });

    continueFirstClaim?.();

    await expect(firstClaim).resolves.toBe('action-id');
    await expect(secondClaim).resolves.toBe(
      LINKEDIN_RUNNER_ACTIVE_ACTION_ERROR,
    );
    expect(runnerState.activeAction?.id).toBe('action-id');
  });
});

describe('LinkedIn runner tab ownership', () => {
  it('does not transfer an enabled runner to a second tab', () => {
    expect(getLinkedinRunnerEnableError(buildState(), 43)).toBe(
      LINKEDIN_RUNNER_ALREADY_OWNED_ERROR,
    );
    expect(getLinkedinRunnerEnableError(buildState(), 42)).toBeNull();
  });

  it('rejects an execution mark from the wrong tab or claim lease', () => {
    const runnerState = buildState({
      activeAction: {
        ...action,
        claimedAt: '2026-08-17T10:00:00.000Z',
      },
      activeActionStartedAt: null,
    });

    expect(
      getLinkedinRunnerActionOwnershipError({
        runnerState,
        tabId: 43,
        actionId: action.id,
        claimedAt: '2026-08-17T10:00:00.000Z',
      }),
    ).toBe('The action is no longer claimed by this runner');
    expect(
      getLinkedinRunnerActionOwnershipError({
        runnerState,
        tabId: 42,
        actionId: action.id,
        claimedAt: '2026-08-17T10:01:00.000Z',
      }),
    ).toBe('The action is no longer claimed by this runner');
  });

  it('preserves the server claim owner when an interrupted action changes tabs', () => {
    const interruptedState = getRunnerStateAfterTabRemoval({
      runnerState: buildState(),
      reportedInterruptedAction: null,
    });
    const recoveredState = {
      ...interruptedState,
      enabled: true,
      tabId: 77,
    };

    expect(recoveredState.activeAction?.claimedBy).toBe('extension-tab-42');
  });
});

describe('LinkedIn runner pause races', () => {
  it('blocks a provider start as soon as pause is requested locally', () => {
    const runnerState = buildState({ activeActionStartedAt: null });

    expect(canStartClaimedLinkedinAction(runnerState, action)).toBe(true);
    expect(canStartClaimedLinkedinAction(runnerState, action, true)).toBe(
      false,
    );
  });

  it('invokes the provider synchronously when pause arrives after the server start', () => {
    const providerOperation = vi.fn();

    expect(
      invokeLinkedinProviderOperationAfterStart({
        runnerState: buildState({ enabled: false }),
        action,
        providerOperation,
      }),
    ).toBe(true);
    expect(providerOperation).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the provider before the authoritative server start', () => {
    const providerOperation = vi.fn();

    expect(
      invokeLinkedinProviderOperationAfterStart({
        runnerState: buildState({ activeActionStartedAt: null }),
        action,
        providerOperation,
      }),
    ).toBe(false);
    expect(providerOperation).not.toHaveBeenCalled();
  });

  it('keeps a tab close during the pre-provider wait in the unstarted release path', async () => {
    let finishPreflight: (() => void) | undefined;
    let tabWasClosed = false;
    const preflight = new Promise<void>((resolve) => {
      finishPreflight = resolve;
    });
    const markExecuting = vi.fn().mockResolvedValue(buildState());
    const authorization = waitForLinkedinProviderStartAuthorization({
      waitForPreflight: () => preflight,
      isPauseRequested: () => tabWasClosed,
      markExecuting,
    });

    await Promise.resolve();

    expect(markExecuting).not.toHaveBeenCalled();
    expect(
      getRunnerStateAfterTabRemoval({
        runnerState: buildState({ activeActionStartedAt: null }),
        reportedInterruptedAction: null,
        unstartedClaimHandled: true,
      }),
    ).toEqual(
      expect.objectContaining({
        activeAction: null,
        activeActionStartedAt: null,
        failedCount: 0,
      }),
    );

    tabWasClosed = true;
    finishPreflight?.();

    await expect(authorization).resolves.toBeNull();
    expect(markExecuting).not.toHaveBeenCalled();
  });

  it('serializes pause behind an in-flight claim and prevents the provider start', async () => {
    const serialize = createSerializedLinkedinRunnerOperation();
    let runnerState = buildState({
      activeAction: null,
      activeActionStartedAt: null,
    });
    let finishRemoteClaim: (() => void) | undefined;
    let markRemoteClaimStarted: (() => void) | undefined;
    const remoteClaimStarted = new Promise<void>((resolve) => {
      markRemoteClaimStarted = resolve;
    });
    const remoteClaimCanFinish = new Promise<void>((resolve) => {
      finishRemoteClaim = resolve;
    });

    const claim = serialize(async () => {
      markRemoteClaimStarted?.();
      await remoteClaimCanFinish;
      runnerState = { ...runnerState, activeAction: action };
    });

    await remoteClaimStarted;

    const pause = serialize(async () => {
      runnerState = getRunnerStateAfterPause({
        runnerState,
        didReleaseUnstartedAction: true,
      });
    });

    finishRemoteClaim?.();
    await Promise.all([claim, pause]);

    expect(runnerState).toEqual(
      expect.objectContaining({
        enabled: false,
        tabId: null,
        activeAction: null,
        activeActionNeedsRelease: false,
      }),
    );
    expect(canStartClaimedLinkedinAction(runnerState, action)).toBe(false);
  });

  it('retains an unstarted claim and its original owner until release is confirmed', () => {
    const pausedState = getRunnerStateAfterPause({
      runnerState: buildState({ activeActionStartedAt: null }),
      didReleaseUnstartedAction: false,
    });

    expect(pausedState).toEqual(
      expect.objectContaining({
        enabled: false,
        tabId: 42,
        activeAction: action,
        activeActionStartedAt: null,
        activeActionNeedsRelease: true,
      }),
    );
    expect(pausedState.activeAction?.claimedBy).toBe('extension-tab-42');
    expect(canStartClaimedLinkedinAction(pausedState, action)).toBe(false);
  });

  it('keeps a started claim owned by the paused tab so its outcome can report', () => {
    const pausedState = getRunnerStateAfterPause({ runnerState: buildState() });

    expect(pausedState).toEqual(
      expect.objectContaining({
        enabled: false,
        tabId: 42,
        activeAction: action,
        activeActionStartedAt: 100,
      }),
    );
    expect(
      getLinkedinRunnerActionOwnershipError({
        runnerState: pausedState,
        tabId: 42,
        actionId: action.id,
        claimedAt: action.claimedAt,
        requireEnabled: false,
      }),
    ).toBeNull();
    expect(
      getLinkedinRunnerActionOwnershipError({
        runnerState: pausedState,
        tabId: 43,
        actionId: action.id,
        claimedAt: action.claimedAt,
        requireEnabled: false,
      }),
    ).toBe('The action is no longer claimed by this runner');
  });
});

describe('LinkedIn runner server reconciliation', () => {
  const buildReconciliationState = (
    actionOverrides: Partial<TwentyLinkedInAction> = {},
  ) =>
    buildState({
      enabled: false,
      activeAction: { ...action, ...actionOverrides },
      activeActionNeedsReconciliation: true,
    });

  it.each(['COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'] as const)(
    'clears local conflict state when the server action is %s',
    (status) => {
      const runnerState = buildReconciliationState();

      expect(
        reconcileRunnerActionWithServer({
          runnerState,
          serverAction: { ...action, status },
        }),
      ).toEqual({
        error: null,
        runnerState: expect.objectContaining({
          activeAction: null,
          activeActionStartedAt: null,
          activeActionNeedsReconciliation: false,
        }),
      });
    },
  );

  it('clears local conflict state when the server row no longer exists', () => {
    expect(
      reconcileRunnerActionWithServer({
        runnerState: buildReconciliationState(),
        serverAction: null,
      }).runnerState,
    ).toEqual(
      expect.objectContaining({
        activeAction: null,
        activeActionNeedsReconciliation: false,
      }),
    );
  });

  it('keeps an inconsistent reconciliation marker without a local action blocked', async () => {
    const runnerState = buildReconciliationState();
    const inconsistentState = { ...runnerState, activeAction: null };

    await expect(
      reconcileRunnerActionOnEnable({
        runnerState: inconsistentState,
        fetchAction: vi.fn(),
        recordRecoveryAttempt: vi.fn(),
      }),
    ).resolves.toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState: inconsistentState,
    });
  });

  it.each(['SEND_CONNECTION_REQUEST', 'WITHDRAW_CONNECTION_REQUEST'] as const)(
    'returns an unclaimed scheduled %s action to normal idempotent recovery',
    (type) => {
      const runnerState = buildReconciliationState({ type });

      expect(
        reconcileRunnerActionWithServer({
          runnerState,
          serverAction: {
            ...action,
            type,
            status: 'SCHEDULED',
            claimedAt: null,
            claimedBy: null,
          },
        }),
      ).toEqual({
        error: null,
        runnerState: expect.objectContaining({
          activeAction: null,
          activeActionNeedsReconciliation: false,
        }),
      });
    },
  );

  it('persists the recovery marker before re-enabling a scheduled idempotent action', async () => {
    const runnerState = buildReconciliationState();
    const serverAction = {
      ...action,
      status: 'SCHEDULED' as const,
      claimedAt: null,
      claimedBy: null,
    };
    const recordRecoveryAttempt = vi.fn().mockResolvedValue(undefined);

    await expect(
      reconcileRunnerActionOnEnable({
        runnerState,
        fetchAction: vi.fn().mockResolvedValue(serverAction),
        recordRecoveryAttempt,
      }),
    ).resolves.toEqual({
      error: null,
      runnerState: expect.objectContaining({
        activeAction: null,
        activeActionNeedsReconciliation: false,
      }),
    });
    expect(recordRecoveryAttempt).toHaveBeenCalledWith(action.id);
  });

  it.each(['SCHEDULED', 'CLAIMED'] as const)(
    'keeps a direct message blocked while its server state is %s',
    (status) => {
      const runnerState = buildReconciliationState({ type: 'SEND_MESSAGE' });
      const serverAction = {
        ...action,
        type: 'SEND_MESSAGE' as const,
        status,
        claimedAt: status === 'SCHEDULED' ? null : action.claimedAt,
        claimedBy: status === 'SCHEDULED' ? null : action.claimedBy,
      };

      expect(
        reconcileRunnerActionWithServer({ runnerState, serverAction }),
      ).toEqual({
        error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
        runnerState,
      });
    },
  );

  it('keeps the exact live claim blocked for an idempotent action', () => {
    const runnerState = buildReconciliationState();

    expect(
      reconcileRunnerActionWithServer({
        runnerState,
        serverAction: { ...action, status: 'CLAIMED' },
      }),
    ).toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    });
  });

  it('keeps ambiguous scheduled claim data blocked', () => {
    const runnerState = buildReconciliationState();

    expect(
      reconcileRunnerActionWithServer({
        runnerState,
        serverAction: { ...action, status: 'SCHEDULED' },
      }),
    ).toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    });
  });

  it('keeps local reconciliation state when the server lookup fails', async () => {
    const runnerState = buildReconciliationState();

    await expect(
      reconcileRunnerActionOnEnable({
        runnerState,
        fetchAction: vi.fn().mockRejectedValue(new Error('network down')),
        recordRecoveryAttempt: vi.fn(),
      }),
    ).resolves.toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_FETCH_ERROR,
      runnerState,
    });
  });
});

describe('LinkedIn runner release reconciliation', () => {
  const buildReleaseState = () =>
    buildState({
      enabled: false,
      activeActionStartedAt: null,
      activeActionNeedsRelease: true,
    });

  it.each(['COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'] as const)(
    'clears an unreleasable local claim after the server action becomes %s',
    (status) => {
      expect(
        reconcileRunnerReleaseWithServer({
          runnerState: buildReleaseState(),
          serverAction: { ...action, status },
        }).runnerState,
      ).toEqual(
        expect.objectContaining({
          activeAction: null,
          activeActionNeedsRelease: false,
        }),
      );
    },
  );

  it('clears an unreleasable local claim when the server row is missing', () => {
    expect(
      reconcileRunnerReleaseWithServer({
        runnerState: buildReleaseState(),
        serverAction: null,
      }),
    ).toEqual({
      error: null,
      runnerState: expect.objectContaining({
        activeAction: null,
        activeActionNeedsRelease: false,
      }),
    });
  });

  it.each([
    'SEND_CONNECTION_REQUEST',
    'SEND_MESSAGE',
    'WITHDRAW_CONNECTION_REQUEST',
  ] as const)(
    'clears a released %s claim after a lost release response',
    (type) => {
      const runnerState = buildState({
        activeAction: { ...action, type },
        activeActionStartedAt: null,
        activeActionNeedsRelease: true,
        enabled: false,
      });

      expect(
        reconcileRunnerReleaseWithServer({
          runnerState,
          serverAction: {
            ...action,
            type,
            status: 'SCHEDULED',
            claimedAt: null,
            claimedBy: null,
          },
        }),
      ).toEqual({
        error: null,
        runnerState: expect.objectContaining({
          activeAction: null,
          activeActionNeedsRelease: false,
        }),
      });
    },
  );

  it('keeps the local claim blocked while the same server lease remains claimed', () => {
    const runnerState = buildReleaseState();

    expect(
      reconcileRunnerReleaseWithServer({
        runnerState,
        serverAction: { ...action, status: 'CLAIMED' },
      }),
    ).toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    });
  });

  it.each([
    {
      label: 'different scheduled action',
      serverAction: {
        ...action,
        id: 'different-action-id',
        status: 'SCHEDULED' as const,
        claimedAt: null,
        claimedBy: null,
      },
    },
    {
      label: 'scheduled action with ambiguous claim metadata',
      serverAction: { ...action, status: 'SCHEDULED' as const },
    },
  ])('keeps the local claim blocked for a $label', ({ serverAction }) => {
    const runnerState = buildReleaseState();

    expect(
      reconcileRunnerReleaseWithServer({
        runnerState,
        serverAction,
      }),
    ).toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    });
  });

  it('preserves the local claim when authoritative release reconciliation fails', async () => {
    const runnerState = buildReleaseState();

    await expect(
      reconcileRunnerReleaseOnEnable({
        runnerState,
        fetchAction: vi.fn().mockRejectedValue(new Error('network down')),
      }),
    ).resolves.toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_FETCH_ERROR,
      runnerState,
    });
  });

  it('releases a server start marker when pause wins before the provider callback', async () => {
    const runnerState = buildState({
      activeAction: { ...action, type: 'SEND_MESSAGE' },
      activeActionStartedAt: 100,
    });
    const releasedAction = {
      ...action,
      type: 'SEND_MESSAGE',
      status: 'SCHEDULED',
      claimedAt: null,
      claimedBy: null,
      executedAt: null,
    } as TwentyLinkedInAction;
    const releaseAction = vi.fn().mockResolvedValue(releasedAction);
    const fetchAction = vi.fn();

    await expect(
      releaseRunnerActionBeforeProviderStart({
        runnerState,
        releaseAction,
        fetchAction,
      }),
    ).resolves.toEqual({
      error: null,
      runnerState: expect.objectContaining({
        enabled: false,
        tabId: null,
        activeAction: null,
        activeActionStartedAt: null,
        activeActionNeedsRelease: false,
        activeActionNeedsReconciliation: false,
        completedCount: 0,
        failedCount: 0,
      }),
    });
    expect(releaseAction).toHaveBeenCalledWith(runnerState.activeAction);
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it('keeps a paused pre-provider action pending release when the release CAS loses', async () => {
    const runnerState = buildState({ activeActionStartedAt: 100 });
    const releaseAction = vi.fn().mockResolvedValue(null);
    const fetchAction = vi
      .fn()
      .mockResolvedValue({ ...action, status: 'CLAIMED' });

    await expect(
      releaseRunnerActionBeforeProviderStart({
        runnerState,
        releaseAction,
        fetchAction,
      }),
    ).resolves.toEqual({
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState: expect.objectContaining({
        enabled: false,
        activeAction: runnerState.activeAction,
        activeActionStartedAt: null,
        activeActionNeedsRelease: true,
        activeActionNeedsReconciliation: false,
      }),
    });
  });
});

describe('LinkedIn runner provider start', () => {
  it('clears a direct-message claim that the server safely re-slotted', () => {
    const directMessage = { ...action, type: 'SEND_MESSAGE' } as const;
    const runnerState = buildState({
      activeAction: directMessage,
      activeActionStartedAt: null,
    });

    expect(
      resolveRunnerProviderStart({
        runnerState,
        serverAction: {
          ...directMessage,
          status: 'SCHEDULED',
          scheduledAt: '2026-08-18T09:00:00.000Z',
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
        },
        requestStartedAt: 100,
      }),
    ).toEqual({
      didStart: false,
      error: null,
      runnerState: expect.objectContaining({
        activeAction: null,
        activeActionStartedAt: null,
        activeActionNeedsRelease: false,
        activeActionNeedsReconciliation: false,
      }),
    });
  });

  it('adopts the authoritative server start time without changing claim identity', () => {
    const runnerState = buildState({ activeActionStartedAt: null });
    const serverStartedAt = '2026-08-17T10:01:00.000Z';

    expect(
      resolveRunnerProviderStart({
        runnerState,
        serverAction: { ...action, executedAt: serverStartedAt },
        requestStartedAt: Date.parse(serverStartedAt),
        now: Date.parse(serverStartedAt) + 1_000,
      }),
    ).toEqual({
      didStart: true,
      error: null,
      runnerState: expect.objectContaining({
        activeAction: { ...action, executedAt: serverStartedAt },
        activeActionStartedAt: Date.parse(serverStartedAt),
        activeActionNeedsRelease: false,
        activeActionNeedsReconciliation: false,
      }),
    });
  });

  it('rejects a claimed response without an authoritative server start time', () => {
    const runnerState = buildState({ activeActionStartedAt: null });

    expect(
      resolveRunnerProviderStart({
        runnerState,
        serverAction: { ...action, executedAt: null },
        requestStartedAt: 100,
        now: 101,
      }),
    ).toEqual({
      didStart: false,
      error:
        'The server returned an unexpected LinkedIn action state before provider start.',
      runnerState: expect.objectContaining({
        enabled: false,
        activeAction: action,
        activeActionStartedAt: null,
        activeActionNeedsRelease: false,
        activeActionNeedsReconciliation: true,
      }),
    });
  });

  it('rejects a delayed provider-start response after its safe execution window', () => {
    const runnerState = buildState({ activeActionStartedAt: null });
    const serverStartedAt = '2026-08-17T10:01:00.000Z';

    expect(
      resolveRunnerProviderStart({
        runnerState,
        serverAction: { ...action, executedAt: serverStartedAt },
        requestStartedAt: 100,
        now: 60_101,
      }),
    ).toEqual({
      didStart: false,
      error:
        'The server returned an unexpected LinkedIn action state before provider start.',
      runnerState: expect.objectContaining({
        enabled: false,
        activeAction: action,
        activeActionStartedAt: null,
        activeActionNeedsRelease: false,
        activeActionNeedsReconciliation: true,
      }),
    });
  });
});

describe('LinkedIn runner action reports', () => {
  it('surfaces a lease conflict and does not count an outcome the server rejected', () => {
    const resolution = resolveRunnerActionReport({
      runnerState: buildState({ completedCount: 3, failedCount: 2 }),
      reportAccepted: false,
      status: 'COMPLETED',
      now: 300,
    });

    expect(resolution).toEqual({
      error: LINKEDIN_ACTION_REPORT_CONFLICT_ERROR,
      runnerState: expect.objectContaining({
        enabled: false,
        activeAction: action,
        activeActionStartedAt: 100,
        activeActionNeedsReconciliation: true,
        lastExecutedAt: null,
        completedCount: 3,
        failedCount: 2,
      }),
    });
  });

  it.each([
    'SEND_CONNECTION_REQUEST',
    'SEND_MESSAGE',
    'WITHDRAW_CONNECTION_REQUEST',
  ] as const)(
    'retains a started %s action when the report compare-and-set loses its lease',
    (type) => {
      const activeAction = { ...action, type };
      const runnerState = buildState({ activeAction });

      expect(
        resolveRunnerActionReport({
          runnerState,
          reportAccepted: false,
          status: 'FAILED',
          now: 300,
        }).runnerState,
      ).toEqual(
        expect.objectContaining({
          enabled: false,
          activeAction,
          activeActionStartedAt: 100,
          activeActionNeedsReconciliation: true,
          lastExecutedAt: null,
          completedCount: 0,
          failedCount: 0,
        }),
      );
    },
  );

  it('counts only an outcome accepted under the active claim lease', () => {
    expect(
      resolveRunnerActionReport({
        runnerState: buildState(),
        reportAccepted: true,
        status: 'COMPLETED',
        now: 300,
      }),
    ).toEqual({
      error: null,
      runnerState: expect.objectContaining({
        activeAction: null,
        lastExecutedAt: 300,
        completedCount: 1,
        failedCount: 0,
      }),
    });
  });
});
