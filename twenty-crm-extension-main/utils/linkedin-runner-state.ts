import type { LinkedInActionType, LinkedInRunnerSessionState } from '../types';

export const canRecoverLinkedInActionAfterInterruption = (
  type: LinkedInActionType,
): boolean => type !== 'SEND_MESSAGE';

export const getRunnerStateAfterTabRemoval = ({
  runnerState,
  didReportInterruptedAction,
  now = Date.now(),
}: {
  runnerState: LinkedInRunnerSessionState;
  didReportInterruptedAction: boolean;
  now?: number;
}): LinkedInRunnerSessionState => {
  const didStartAction =
    runnerState.activeAction !== null &&
    runnerState.activeActionStartedAt !== null;
  const shouldPreserveUnreportedAction =
    didStartAction && !didReportInterruptedAction;

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
    lastExecutedAt: didReportInterruptedAction
      ? now
      : runnerState.lastExecutedAt,
    failedCount: runnerState.failedCount + (didReportInterruptedAction ? 1 : 0),
  };
};
