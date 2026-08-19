import type {
  LinkedInActionStatus,
  LinkedInActionType,
  LinkedInRunnerSessionState,
  TwentyLinkedInAction,
} from '../types';

export const LINKEDIN_ACTION_REPORT_CONFLICT_ERROR =
  'The LinkedIn action ran, but the server no longer accepts this claim. Its outcome must be reconciled before retrying.';

export const LINKEDIN_RUNNER_ALREADY_OWNED_ERROR =
  'The LinkedIn runner is already active in another tab.';

export const LINKEDIN_RUNNER_NOT_OWNED_ERROR =
  'This tab is not the active LinkedIn runner.';

export const LINKEDIN_RUNNER_ACTIVE_ACTION_ERROR =
  'The LinkedIn runner already has an action awaiting completion or reconciliation.';

export const LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR =
  'The LinkedIn action still has a non-terminal server state and cannot be retried safely.';

export const LINKEDIN_ACTION_RECONCILIATION_FETCH_ERROR =
  "The LinkedIn action's server state could not be verified. The runner remains paused.";

const LINKEDIN_PROVIDER_START_RESPONSE_MAX_AGE_MILLISECONDS = 60_000;

export const createSerializedLinkedinRunnerOperation = () => {
  let previousOperation: Promise<void> = Promise.resolve();

  return <TResult>(operation: () => Promise<TResult>): Promise<TResult> => {
    const result = previousOperation.then(operation, operation);

    previousOperation = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  };
};

export const getLinkedinRunnerEnableError = (
  runnerState: LinkedInRunnerSessionState,
  tabId: number | undefined,
  allowReconciliation = false,
): string | null => {
  if (typeof tabId !== 'number') {
    return 'The runner tab could not be identified';
  }

  if (
    runnerState.enabled &&
    runnerState.tabId !== null &&
    runnerState.tabId !== tabId
  ) {
    return LINKEDIN_RUNNER_ALREADY_OWNED_ERROR;
  }

  if (runnerState.activeActionNeedsReconciliation && !allowReconciliation) {
    return LINKEDIN_ACTION_REPORT_CONFLICT_ERROR;
  }

  return null;
};

export const getLinkedinRunnerClaimError = (
  runnerState: LinkedInRunnerSessionState,
  tabId: number | undefined,
): string | null => {
  if (
    typeof tabId !== 'number' ||
    !runnerState.enabled ||
    runnerState.tabId !== tabId
  ) {
    return LINKEDIN_RUNNER_NOT_OWNED_ERROR;
  }

  if (
    runnerState.activeAction !== null ||
    runnerState.activeActionNeedsRelease ||
    runnerState.activeActionNeedsReconciliation
  ) {
    return LINKEDIN_RUNNER_ACTIVE_ACTION_ERROR;
  }

  return null;
};

export const getLinkedinRunnerActionOwnershipError = ({
  runnerState,
  tabId,
  actionId,
  claimedAt,
  requireEnabled = true,
}: {
  runnerState: LinkedInRunnerSessionState;
  tabId: number | undefined;
  actionId: string;
  claimedAt: string | null;
  requireEnabled?: boolean;
}): string | null => {
  if (
    typeof tabId !== 'number' ||
    (requireEnabled && !runnerState.enabled) ||
    runnerState.tabId !== tabId ||
    runnerState.activeAction?.id !== actionId ||
    runnerState.activeAction.claimedAt !== claimedAt ||
    runnerState.activeActionNeedsRelease ||
    runnerState.activeActionNeedsReconciliation
  ) {
    return 'The action is no longer claimed by this runner';
  }

  return null;
};

export const canStartClaimedLinkedinAction = (
  runnerState: LinkedInRunnerSessionState,
  action: TwentyLinkedInAction,
  isPauseRequested = false,
): boolean =>
  !isPauseRequested &&
  runnerState.enabled &&
  runnerState.activeAction?.id === action.id &&
  runnerState.activeAction.claimedAt === action.claimedAt &&
  !runnerState.activeActionNeedsRelease &&
  !runnerState.activeActionNeedsReconciliation;

export const getRunnerStateAfterPause = ({
  runnerState,
  didReleaseUnstartedAction = false,
}: {
  runnerState: LinkedInRunnerSessionState;
  didReleaseUnstartedAction?: boolean;
}): LinkedInRunnerSessionState => {
  const hasUnstartedAction =
    runnerState.activeAction !== null &&
    runnerState.activeActionStartedAt === null;
  const shouldClearAction = hasUnstartedAction && didReleaseUnstartedAction;
  const activeAction = shouldClearAction ? null : runnerState.activeAction;

  return {
    ...runnerState,
    enabled: false,
    tabId: activeAction === null ? null : runnerState.tabId,
    activeAction,
    activeActionStartedAt: shouldClearAction
      ? null
      : runnerState.activeActionStartedAt,
    activeActionNeedsRelease:
      activeAction !== null &&
      (hasUnstartedAction
        ? !didReleaseUnstartedAction
        : runnerState.activeActionNeedsRelease),
    activeActionNeedsReconciliation:
      activeAction !== null && runnerState.activeActionNeedsReconciliation,
  };
};

const clearRunnerActionForReconciliation = (
  runnerState: LinkedInRunnerSessionState,
): LinkedInRunnerSessionState => ({
  ...runnerState,
  tabId: runnerState.enabled ? runnerState.tabId : null,
  activeAction: null,
  activeActionStartedAt: null,
  activeActionNeedsRelease: false,
  activeActionNeedsReconciliation: false,
});

export const resolveRunnerProviderStart = ({
  runnerState,
  serverAction,
  requestStartedAt,
  now = Date.now(),
}: {
  runnerState: LinkedInRunnerSessionState;
  serverAction: TwentyLinkedInAction;
  requestStartedAt: number;
  now?: number;
}): {
  didStart: boolean;
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
} => {
  const localAction = runnerState.activeAction;
  const isSameAction =
    localAction !== null &&
    serverAction.id === localAction.id &&
    serverAction.type === localAction.type;

  if (
    isSameAction &&
    serverAction.status === 'SCHEDULED' &&
    serverAction.claimedAt === null &&
    serverAction.claimedBy === null
  ) {
    return {
      didStart: false,
      error: null,
      runnerState: clearRunnerActionForReconciliation(runnerState),
    };
  }

  const serverStartedAt = Date.parse(serverAction.executedAt ?? '');
  const providerStartResponseAge = now - requestStartedAt;
  const serverStartResponseIsFresh =
    providerStartResponseAge >= 0 &&
    providerStartResponseAge <=
      LINKEDIN_PROVIDER_START_RESPONSE_MAX_AGE_MILLISECONDS;

  if (
    !isSameAction ||
    serverAction.status !== 'CLAIMED' ||
    serverAction.claimedAt !== localAction.claimedAt ||
    serverAction.claimedBy !== localAction.claimedBy ||
    Number.isNaN(serverStartedAt) ||
    !serverStartResponseIsFresh
  ) {
    return {
      didStart: false,
      error:
        'The server returned an unexpected LinkedIn action state before provider start.',
      runnerState: {
        ...runnerState,
        enabled: false,
        activeActionNeedsRelease: false,
        activeActionNeedsReconciliation: true,
      },
    };
  }

  return {
    didStart: true,
    error: null,
    runnerState: {
      ...runnerState,
      activeAction: serverAction,
      activeActionStartedAt: serverStartedAt,
      activeActionNeedsRelease: false,
      activeActionNeedsReconciliation: false,
    },
  };
};

export const invokeLinkedinProviderOperationAfterStart = ({
  runnerState,
  action,
  providerOperation,
}: {
  runnerState: LinkedInRunnerSessionState;
  action: TwentyLinkedInAction;
  providerOperation: () => void;
}): boolean => {
  const activeAction = runnerState.activeAction;

  if (
    activeAction?.id !== action.id ||
    activeAction.type !== action.type ||
    activeAction.claimedAt !== action.claimedAt ||
    activeAction.claimedBy !== action.claimedBy ||
    runnerState.activeActionStartedAt === null
  ) {
    return false;
  }

  // The accepted server start is the linearization point. Local pause state
  // may change immediately afterward, but it must not add a controllable abort
  // branch between authorization and the synchronous provider callback.
  providerOperation();

  return true;
};

const isTerminalLinkedinActionStatus = (
  status: LinkedInActionStatus,
): boolean =>
  status === 'COMPLETED' ||
  status === 'SKIPPED' ||
  status === 'FAILED' ||
  status === 'CANCELLED';

export const reconcileRunnerActionWithServer = ({
  runnerState,
  serverAction,
}: {
  runnerState: LinkedInRunnerSessionState;
  serverAction: TwentyLinkedInAction | null;
}): {
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
} => {
  const localAction = runnerState.activeAction;

  if (localAction === null) {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    };
  }

  if (serverAction === null) {
    return {
      error: null,
      runnerState: clearRunnerActionForReconciliation(runnerState),
    };
  }

  if (isTerminalLinkedinActionStatus(serverAction.status)) {
    return {
      error: null,
      runnerState: clearRunnerActionForReconciliation(runnerState),
    };
  }

  const isSameAction =
    serverAction.id === localAction.id &&
    serverAction.type === localAction.type;
  const isUnclaimedScheduledAction =
    serverAction.status === 'SCHEDULED' &&
    serverAction.claimedAt === null &&
    serverAction.claimedBy === null;

  if (
    isSameAction &&
    isUnclaimedScheduledAction &&
    canRecoverLinkedInActionAfterInterruption(localAction.type)
  ) {
    return {
      error: null,
      runnerState: clearRunnerActionForReconciliation(runnerState),
    };
  }

  return {
    error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
    runnerState,
  };
};

export const reconcileRunnerReleaseWithServer = ({
  runnerState,
  serverAction,
}: {
  runnerState: LinkedInRunnerSessionState;
  serverAction: TwentyLinkedInAction | null;
}): {
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
} => {
  if (runnerState.activeAction === null) {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    };
  }

  if (
    serverAction === null ||
    isTerminalLinkedinActionStatus(serverAction.status)
  ) {
    return {
      error: null,
      runnerState: clearRunnerActionForReconciliation(runnerState),
    };
  }

  const isSameUnclaimedScheduledAction =
    serverAction.id === runnerState.activeAction.id &&
    serverAction.type === runnerState.activeAction.type &&
    serverAction.status === 'SCHEDULED' &&
    serverAction.claimedAt === null &&
    serverAction.claimedBy === null;

  // A release may commit even when its response is lost. The retry then loses
  // its old lease CAS and returns null, but this authoritative state proves
  // that the exact unstarted action is back in the queue and no longer ours.
  if (isSameUnclaimedScheduledAction) {
    return {
      error: null,
      runnerState: clearRunnerActionForReconciliation(runnerState),
    };
  }

  return {
    error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
    runnerState,
  };
};

export const reconcileRunnerReleaseOnEnable = async ({
  runnerState,
  fetchAction,
}: {
  runnerState: LinkedInRunnerSessionState;
  fetchAction: (id: string) => Promise<TwentyLinkedInAction | null>;
}): Promise<{
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
}> => {
  if (runnerState.activeAction === null) {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    };
  }

  try {
    return reconcileRunnerReleaseWithServer({
      runnerState,
      serverAction: await fetchAction(runnerState.activeAction.id),
    });
  } catch {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_FETCH_ERROR,
      runnerState,
    };
  }
};

export const releaseRunnerActionBeforeProviderStart = async ({
  runnerState,
  releaseAction,
  fetchAction,
}: {
  runnerState: LinkedInRunnerSessionState;
  releaseAction: (
    action: TwentyLinkedInAction,
  ) => Promise<TwentyLinkedInAction | null>;
  fetchAction: (id: string) => Promise<TwentyLinkedInAction | null>;
}): Promise<{
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
}> => {
  if (runnerState.activeAction === null) {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    };
  }

  // Keep a locally unstarted claim in release-pending state until the server
  // confirms either the release or an authoritative terminal/rescheduled row.
  // A committed provider start is deliberately not releasable through this
  // path because its external outcome may already be unknown.
  const releasePendingState: LinkedInRunnerSessionState = {
    ...runnerState,
    enabled: false,
    activeActionStartedAt: null,
    activeActionNeedsRelease: true,
    activeActionNeedsReconciliation: false,
  };

  try {
    const releasedAction = await releaseAction(runnerState.activeAction);

    if (releasedAction !== null) {
      return {
        error: null,
        runnerState: clearRunnerActionForReconciliation(releasePendingState),
      };
    }

    return reconcileRunnerReleaseOnEnable({
      runnerState: releasePendingState,
      fetchAction,
    });
  } catch (error) {
    return {
      error: `Could not release the paused action before provider start: ${
        error instanceof Error ? error.message : String(error)
      }`,
      runnerState: releasePendingState,
    };
  }
};

export const reconcileRunnerActionOnEnable = async ({
  runnerState,
  fetchAction,
  recordRecoveryAttempt,
}: {
  runnerState: LinkedInRunnerSessionState;
  fetchAction: (id: string) => Promise<TwentyLinkedInAction | null>;
  recordRecoveryAttempt: (id: string) => Promise<void>;
}): Promise<{
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
}> => {
  if (!runnerState.activeActionNeedsReconciliation) {
    return { error: null, runnerState };
  }

  if (runnerState.activeAction === null) {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_BLOCKED_ERROR,
      runnerState,
    };
  }

  try {
    const serverAction = await fetchAction(runnerState.activeAction.id);
    const reconciliation = reconcileRunnerActionWithServer({
      runnerState,
      serverAction,
    });

    if (
      reconciliation.error === null &&
      serverAction?.status === 'SCHEDULED' &&
      canRecoverLinkedInActionAfterInterruption(runnerState.activeAction.type)
    ) {
      await recordRecoveryAttempt(runnerState.activeAction.id);
    }

    return reconciliation;
  } catch {
    return {
      error: LINKEDIN_ACTION_RECONCILIATION_FETCH_ERROR,
      runnerState,
    };
  }
};

export const waitForLinkedinProviderStartAuthorization = async <TResult>({
  waitForPreflight,
  isPauseRequested,
  markExecuting,
}: {
  waitForPreflight: () => Promise<void>;
  isPauseRequested: () => boolean;
  markExecuting: () => Promise<TResult>;
}): Promise<TResult | null> => {
  await waitForPreflight();

  if (isPauseRequested()) {
    return null;
  }

  return markExecuting();
};

export const canRecoverLinkedInActionAfterInterruption = (
  type: LinkedInActionType,
): boolean => type !== 'SEND_MESSAGE';

export const claimFirstAvailableLinkedinAction = async (
  actions: TwentyLinkedInAction[],
  claim: (action: TwentyLinkedInAction) => Promise<TwentyLinkedInAction | null>,
): Promise<TwentyLinkedInAction | null> => {
  for (const action of actions) {
    const claimedAction = await claim(action);

    if (claimedAction !== null) {
      return claimedAction;
    }
  }

  return null;
};

export const getRunnerStateAfterTabRemoval = ({
  runnerState,
  reportedInterruptedAction,
  unstartedClaimHandled = false,
  now = Date.now(),
}: {
  runnerState: LinkedInRunnerSessionState;
  reportedInterruptedAction: TwentyLinkedInAction | null;
  unstartedClaimHandled?: boolean;
  now?: number;
}): LinkedInRunnerSessionState => {
  const didReportInterruptedAction = reportedInterruptedAction !== null;
  const didStartAction =
    runnerState.activeAction !== null &&
    runnerState.activeActionStartedAt !== null;
  const shouldPreserveUnreportedAction =
    runnerState.activeAction !== null &&
    !didReportInterruptedAction &&
    (didStartAction || !unstartedClaimHandled);

  return {
    ...runnerState,
    enabled: false,
    tabId: null,
    activeAction: shouldPreserveUnreportedAction
      ? runnerState.activeAction
      : null,
    activeActionStartedAt: shouldPreserveUnreportedAction
      ? runnerState.activeActionStartedAt
      : null,
    activeActionNeedsRelease: shouldPreserveUnreportedAction && !didStartAction,
    activeActionNeedsReconciliation:
      shouldPreserveUnreportedAction &&
      (runnerState.activeActionNeedsReconciliation ||
        (didStartAction &&
          runnerState.activeAction !== null &&
          !canRecoverLinkedInActionAfterInterruption(
            runnerState.activeAction.type,
          ))),
    lastExecutedAt: didReportInterruptedAction
      ? now
      : runnerState.lastExecutedAt,
    failedCount: runnerState.failedCount + (didReportInterruptedAction ? 1 : 0),
  };
};

export const resolveRunnerActionReport = ({
  runnerState,
  reportAccepted,
  status,
  now = Date.now(),
}: {
  runnerState: LinkedInRunnerSessionState;
  reportAccepted: boolean;
  status: Extract<LinkedInActionStatus, 'COMPLETED' | 'SKIPPED' | 'FAILED'>;
  now?: number;
}): {
  error: string | null;
  runnerState: LinkedInRunnerSessionState;
} => {
  if (!reportAccepted && runnerState.activeActionStartedAt !== null) {
    return {
      error: LINKEDIN_ACTION_REPORT_CONFLICT_ERROR,
      runnerState: {
        ...runnerState,
        enabled: false,
        activeActionNeedsReconciliation: true,
      },
    };
  }

  return {
    error: reportAccepted ? null : LINKEDIN_ACTION_REPORT_CONFLICT_ERROR,
    runnerState: {
      ...runnerState,
      tabId: runnerState.enabled ? runnerState.tabId : null,
      activeAction: null,
      activeActionStartedAt: null,
      activeActionNeedsRelease: false,
      activeActionNeedsReconciliation: false,
      lastExecutedAt: now,
      completedCount:
        runnerState.completedCount +
        (reportAccepted && status !== 'FAILED' ? 1 : 0),
      failedCount:
        runnerState.failedCount +
        (reportAccepted && status === 'FAILED' ? 1 : 0),
    },
  };
};
