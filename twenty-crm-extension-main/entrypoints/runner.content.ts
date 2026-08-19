import type {
  ExtensionResponse,
  LinkedInIdentity,
  LinkedInRunnerSessionState,
  LinkedInSafetySnapshot,
  LinkedInSyncLock,
  LinkedInSyncProgress,
  LinkedInSyncState,
  LinkedInSyncTotals,
  TwentyLinkedInAction,
} from '../types';
import {
  getLinkedInAutomationBlockReason,
  sendConnectionRequest,
  sendDirectMessage,
  withdrawConnectionRequest,
  type LinkedInAutomationResult,
  type LinkedInProviderOperationAuthorizer,
} from '../utils/linkedin-automation';
import {
  assertLinkedInIdempotentRecoveryAllowed,
  assertLinkedInOutboundAllowed,
  getLinkedInSafetySnapshot,
  LinkedInSafetyLimitError,
  recordLinkedInOutboundAttempt,
  tripLinkedInSafetyCircuit,
  wasLinkedInOutboundActionAttempted,
} from '../utils/linkedin-safety';
import {
  LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS,
  LINKEDIN_READ_REQUESTS_PER_DAY,
  LINKEDIN_READ_REQUESTS_PER_HOUR,
} from '../utils/linkedin-safety-policy';
import {
  canStartClaimedLinkedinAction,
  canRecoverLinkedInActionAfterInterruption,
  claimFirstAvailableLinkedinAction,
  invokeLinkedinProviderOperationAfterStart,
} from '../utils/linkedin-runner-state';
import { syncLinkedInConnectionsAndInvitations } from '../utils/linkedin-sync-connections';
import { syncLinkedInMessages } from '../utils/linkedin-sync-messages';
import {
  getCachedLinkedInIdentity,
  getLinkedInSyncState,
  LINKEDIN_CONNECTION_SYNC_REVISION,
  LINKEDIN_INVITATION_SYNC_REVISION,
  LINKEDIN_MESSAGE_SYNC_REVISION,
  setCachedLinkedInIdentity,
  updateLinkedInSyncState,
} from '../utils/linkedin-sync-state';
import { linkedInVoyagerClient } from '../utils/linkedin-voyager-client';

const RUNNER_LOCAL_MINIMUM_GAP_MILLISECONDS =
  LINKEDIN_OUTBOUND_MINIMUM_GAP_MILLISECONDS;
const RUNNER_POLL_INTERVAL_MILLISECONDS = 60_000;
const HARVEST_AUTO_SYNC_INTERVAL_MILLISECONDS = 60_000;
const HARVEST_COMPLETED_SYNC_GAP_MILLISECONDS = 30 * 60_000;
const HARVEST_RECENT_SYNC_TTL_MILLISECONDS = 2 * 60_000;
const HARVEST_HEARTBEAT_INTERVAL_MILLISECONDS = 10_000;
const HARVEST_LOCK_STATUS_INTERVAL_MILLISECONDS = 5_000;
const HARVEST_TOTALS_INTERVAL_MILLISECONDS = 30_000;

const RUNNER_STYLES = `
  .twenty-linkedin-runner-root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    position: fixed;
    right: 24px;
    top: 68px;
    z-index: 99998;
  }

  .twenty-linkedin-runner-button {
    align-items: center;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border: none;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    color: white;
    cursor: pointer;
    display: flex;
    font-size: 13px;
    font-weight: 700;
    gap: 8px;
    padding: 8px 12px 8px 8px;
  }

  .twenty-linkedin-runner-logo {
    height: 24px;
    width: 24px;
  }

  .twenty-linkedin-runner-dot {
    background: #d1d5db;
    border-radius: 50%;
    height: 8px;
    width: 8px;
  }

  .twenty-linkedin-runner-dot.is-running {
    background: #4ade80;
  }

  .twenty-linkedin-runner-panel {
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
    color: #1f2937;
    max-height: calc(100vh - 88px);
    max-width: calc(100vw - 32px);
    overflow-y: auto;
    position: absolute;
    right: 0;
    top: 48px;
    width: 360px;
  }

  .twenty-linkedin-runner-header {
    align-items: center;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    padding: 9px 12px;
  }

  .twenty-linkedin-runner-title {
    font-size: 14px;
    font-weight: 700;
  }

  .twenty-linkedin-runner-close {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 18px;
  }

  .twenty-linkedin-runner-body {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px;
  }

  .twenty-linkedin-runner-stats {
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(4, 1fr);
  }

  .twenty-linkedin-runner-section-title {
    color: #6b7280;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .twenty-linkedin-runner-divider {
    background: #e5e7eb;
    height: 1px;
  }

  .twenty-linkedin-runner-stat {
    background: #f3f4f6;
    border-radius: 8px;
    font-size: 12px;
    min-width: 0;
    padding: 6px;
    text-align: center;
  }

  .twenty-linkedin-runner-stat strong {
    display: block;
    font-size: 14px;
    margin-bottom: 1px;
  }

  .twenty-linkedin-runner-warning,
  .twenty-linkedin-runner-status {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    color: #92400e;
    font-size: 12px;
    line-height: 1.4;
    padding: 7px 8px;
  }

  .twenty-linkedin-runner-status {
    background: #f9fafb;
    border-color: #e5e7eb;
    color: #4b5563;
  }

  .twenty-linkedin-runner-status.is-error {
    background: #fffbeb;
    border-color: #fde68a;
    color: #92400e;
  }

  .twenty-linkedin-runner-meta {
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .twenty-linkedin-runner-meta .twenty-linkedin-runner-status {
    font-size: 11px;
    overflow-wrap: anywhere;
    padding: 6px;
  }

  .twenty-linkedin-runner-sync-copy {
    color: #6b7280;
    font-size: 11px;
    margin: 0;
  }

  .twenty-linkedin-runner-action {
    background: #6366f1;
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 12px;
    width: 100%;
  }

  .twenty-linkedin-runner-action.is-pause {
    background: #374151;
  }

  .twenty-linkedin-runner-action.is-harvest {
    background: #0a66c2;
  }
`;

const defaultRunnerState = (): LinkedInRunnerSessionState => ({
  enabled: false,
  tabId: null,
  activeAction: null,
  activeActionStartedAt: null,
  activeActionNeedsRelease: false,
  activeActionNeedsReconciliation: false,
  lastExecutedAt: null,
  completedCount: 0,
  failedCount: 0,
});

const emptySyncProgress = (): LinkedInSyncProgress => ({
  connections: 0,
  invitations: 0,
  threads: 0,
  messages: 0,
});

const emptySafetySnapshot = (): LinkedInSafetySnapshot => ({
  readRequestsLastHour: 0,
  readRequestsToday: 0,
  outboundAttemptsToday: 0,
  dailyReadLimitEnabled: false,
  dailyReadLimit: LINKEDIN_READ_REQUESTS_PER_DAY,
  nextOutboundAt: null,
  cooldownUntil: null,
  cooldownReason: null,
});

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const getProfileHandle = (value: string): string | null => {
  try {
    return new URL(value).pathname.match(/^\/in\/([^/]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
};

const getPageLinkedInId = (): string | null =>
  document
    .querySelector<HTMLMetaElement>('meta[name="__init"]')
    ?.content.match(/urn:li:member:(\d+)/)?.[1] ?? null;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export default defineContentScript({
  matches: ['*://*.linkedin.com/*'],
  runAt: 'document_idle',

  main(ctx) {
    let runnerState = defaultRunnerState();
    let isRunnerPauseRequested = false;
    let queue: TwentyLinkedInAction[] = [];
    let isPanelOpen = false;
    let isPolling = false;
    let statusMessage = 'Runner is paused.';
    let statusIsError = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    let isHarvestSyncing = false;
    let isHarvestOwnedByAnotherTab = false;
    let harvestIdentity: LinkedInIdentity | null = null;
    let harvestSyncState: LinkedInSyncState | null = null;
    let harvestTotals = emptySyncProgress();
    let harvestProgress = emptySyncProgress();
    let harvestStatusMessage = 'Waiting for the next automatic sync.';
    let harvestStatusIsError = false;
    let safetySnapshot = emptySafetySnapshot();
    let harvestLockKey: string | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let autoSyncInterval: ReturnType<typeof setInterval> | null = null;
    let lockStatusInterval: ReturnType<typeof setInterval> | null = null;
    let totalsInterval: ReturnType<typeof setInterval> | null = null;
    const root = document.createElement('div');
    const style = document.createElement('style');

    root.className = 'twenty-linkedin-runner-root';
    style.textContent = RUNNER_STYLES;
    document.head.appendChild(style);
    document.body.appendChild(root);

    const sendMessage = async <TData>(
      type: string,
      payload?: unknown,
    ): Promise<ExtensionResponse<TData>> =>
      browser.runtime.sendMessage({ type, payload }) as Promise<
        ExtensionResponse<TData>
      >;

    const refreshRunnerState = async () => {
      const response = await sendMessage<LinkedInRunnerSessionState>(
        'GET_LINKEDIN_RUNNER_STATE',
      );

      runnerState =
        response.success && response.data
          ? response.data
          : defaultRunnerState();
    };

    const refreshQueue = async () => {
      const response = await sendMessage<TwentyLinkedInAction[]>(
        'FETCH_LINKEDIN_ACTION_QUEUE',
      );

      queue = response.success && response.data ? response.data : [];
    };

    const refreshHarvestTotals = async () => {
      const response = await sendMessage<LinkedInSyncTotals>(
        'GET_LINKEDIN_SYNC_TOTALS',
        harvestIdentity
          ? { ownerLinkedinId: harvestIdentity.linkedinId }
          : undefined,
      );

      if (response.success && response.data) {
        harvestTotals = response.data;
      }
    };

    const refreshSafetySnapshot = async () => {
      safetySnapshot = await getLinkedInSafetySnapshot();
    };

    const refreshHarvestIdentity = async (): Promise<LinkedInIdentity> => {
      const cachedIdentity = await getCachedLinkedInIdentity();

      await linkedInVoyagerClient.initialize();

      if (cachedIdentity) {
        harvestIdentity = cachedIdentity;
      } else {
        harvestIdentity = await linkedInVoyagerClient.getIdentity();
        await setCachedLinkedInIdentity(harvestIdentity);
      }

      harvestSyncState = await getLinkedInSyncState(harvestIdentity.linkedinId);

      return harvestIdentity;
    };

    const releaseHarvestLock = async () => {
      if (!harvestLockKey) {
        return;
      }

      const key = harvestLockKey;

      harvestLockKey = null;
      await sendMessage('SYNC_LOCK_RELEASE', { key }).catch(() => undefined);
    };

    const heartbeatHarvestLock = async () => {
      if (!harvestLockKey || !isHarvestSyncing) {
        return;
      }

      const response = await sendMessage<{ lock: LinkedInSyncLock | null }>(
        'SYNC_LOCK_HEARTBEAT',
        { key: harvestLockKey, progress: harvestProgress },
      );

      if (!response.success) {
        harvestStatusMessage =
          response.error || 'This tab lost the LinkedIn sync lock.';
        harvestStatusIsError = true;
      }

      render();
    };

    const refreshHarvestLockStatus = async () => {
      if (isHarvestSyncing) {
        return;
      }

      const ownerLinkedinId =
        harvestIdentity?.linkedinId ?? getPageLinkedInId();

      if (!ownerLinkedinId) {
        return;
      }

      const key = `${ownerLinkedinId}:all`;
      const response = await sendMessage<{ lock: LinkedInSyncLock | null }>(
        'SYNC_LOCK_STATUS',
        { key },
      );
      const lock = response.data?.lock ?? null;

      isHarvestOwnedByAnotherTab = Boolean(lock);

      if (lock) {
        harvestProgress = lock.progress;
        harvestStatusMessage = 'Sync in progress in another tab.';
        harvestStatusIsError = false;
      } else if (harvestStatusMessage.includes('another tab')) {
        harvestStatusMessage = 'Waiting for the next automatic sync.';
      }

      render();
    };

    const shouldRunHarvest = (force: boolean): boolean => {
      if (force || !harvestSyncState) {
        return true;
      }

      if (
        harvestSyncState.connectionSyncRevision !==
          LINKEDIN_CONNECTION_SYNC_REVISION ||
        !harvestSyncState.connectionBackfillComplete ||
        harvestSyncState.messageSyncRevision !==
          LINKEDIN_MESSAGE_SYNC_REVISION ||
        harvestSyncState.invitationSyncRevision !==
          LINKEDIN_INVITATION_SYNC_REVISION
      ) {
        return true;
      }

      if (
        harvestSyncState.syncStartedAt &&
        Date.now() - harvestSyncState.syncStartedAt <
          HARVEST_RECENT_SYNC_TTL_MILLISECONDS
      ) {
        return false;
      }

      return (
        !harvestSyncState.lastAttemptAt ||
        Date.now() - harvestSyncState.lastAttemptAt >=
          HARVEST_COMPLETED_SYNC_GAP_MILLISECONDS
      );
    };

    const syncAllHarvestData = async (force = false) => {
      if (isHarvestSyncing) {
        return;
      }

      try {
        await refreshSafetySnapshot();

        if (
          safetySnapshot.cooldownUntil !== null &&
          safetySnapshot.cooldownUntil > Date.now()
        ) {
          harvestStatusMessage = `${safetySnapshot.cooldownReason ?? 'LinkedIn safety cooldown is active.'} Sync will remain paused until ${new Date(safetySnapshot.cooldownUntil).toLocaleString()}.`;
          harvestStatusIsError = true;
          render();
          return;
        }

        harvestProgress = emptySyncProgress();
        let ownerLinkedinId =
          harvestIdentity?.linkedinId ?? getPageLinkedInId();

        if (!ownerLinkedinId) {
          ownerLinkedinId = (await refreshHarvestIdentity()).linkedinId;
        }

        const key = `${ownerLinkedinId}:all`;
        const lockResponse = await sendMessage<{
          acquired: boolean;
          lock: LinkedInSyncLock;
        }>('SYNC_LOCK_ACQUIRE', { key, progress: harvestProgress });

        if (!lockResponse.success || !lockResponse.data) {
          throw new Error(
            lockResponse.error || 'Could not acquire the LinkedIn sync lock',
          );
        }

        if (!lockResponse.data.acquired) {
          isHarvestOwnedByAnotherTab = true;
          harvestProgress = lockResponse.data.lock.progress;
          harvestStatusMessage = 'Sync in progress in another tab.';
          harvestStatusIsError = false;
          render();
          return;
        }

        isHarvestSyncing = true;
        isHarvestOwnedByAnotherTab = false;
        harvestLockKey = key;
        harvestStatusMessage = 'Preparing LinkedIn sync…';
        harvestStatusIsError = false;
        render();

        heartbeatInterval = setInterval(
          () => void heartbeatHarvestLock(),
          HARVEST_HEARTBEAT_INTERVAL_MILLISECONDS,
        );

        const identity = await refreshHarvestIdentity();

        if (identity.linkedinId !== ownerLinkedinId) {
          throw new Error('The signed-in LinkedIn account changed during sync');
        }

        if (!shouldRunHarvest(force)) {
          harvestStatusMessage = 'Waiting for the next automatic sync.';
          harvestStatusIsError = false;
          return;
        }

        const runStartedAt = Date.now();

        harvestSyncState = await updateLinkedInSyncState(identity.linkedinId, {
          syncStartedAt: runStartedAt,
          lastAttemptAt: runStartedAt,
          lastError: null,
        });
        harvestStatusMessage = 'Syncing LinkedIn data incrementally…';
        render();

        const [connectionsResult] = await Promise.allSettled([
          syncLinkedInConnectionsAndInvitations(
            identity.linkedinId,
            runStartedAt,
            harvestProgress,
          ),
        ]);
        const messagesResult =
          connectionsResult.status === 'fulfilled'
            ? (
                await Promise.allSettled([
                  syncLinkedInMessages(identity, harvestProgress),
                ])
              )[0]
            : connectionsResult;
        const completedAt = Date.now();
        const stateUpdate: Partial<LinkedInSyncState> = {
          syncStartedAt: null,
        };

        if (connectionsResult.status === 'fulfilled') {
          stateUpdate.lastConnectionSyncAt = completedAt;
        }

        if (messagesResult.status === 'fulfilled') {
          stateUpdate.lastMessageSyncAt = completedAt;
        }

        const errors = [
          ...new Set(
            [connectionsResult, messagesResult]
              .filter(
                (result): result is PromiseRejectedResult =>
                  result.status === 'rejected',
              )
              .map((result) =>
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
              ),
          ),
        ];

        harvestSyncState = await updateLinkedInSyncState(
          identity.linkedinId,
          stateUpdate,
        );

        if (errors.length > 0) {
          throw new Error(errors.join('; '));
        }

        const warnings =
          connectionsResult.status === 'fulfilled'
            ? connectionsResult.value.warnings
            : [];

        harvestSyncState = await updateLinkedInSyncState(identity.linkedinId, {
          lastRunAt: completedAt,
          lastError: null,
        });
        harvestStatusMessage =
          warnings.length > 0
            ? `LinkedIn sync completed. ${warnings.join(' ')}`
            : 'LinkedIn sync completed.';
        harvestStatusIsError = false;
        await Promise.all([refreshHarvestTotals(), refreshSafetySnapshot()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        harvestStatusMessage = message;
        harvestStatusIsError = !/read limit reached/i.test(message);
        await refreshSafetySnapshot().catch(() => undefined);

        if (harvestIdentity) {
          harvestSyncState = await updateLinkedInSyncState(
            harvestIdentity.linkedinId,
            { syncStartedAt: null, lastError: message },
          );
        }
      } finally {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        isHarvestSyncing = false;
        await releaseHarvestLock();
        render();
      }
    };

    const schedulePoll = (delayMilliseconds: number) => {
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }

      pollTimeout = setTimeout(
        () => void poll(),
        Math.max(
          0,
          Math.min(delayMilliseconds, RUNNER_POLL_INTERVAL_MILLISECONDS),
        ),
      );
    };

    const ensureActionPage = (action: TwentyLinkedInAction): boolean => {
      const targetHandle = getProfileHandle(action.linkedinUrl)?.toLowerCase();
      const currentHandle = getProfileHandle(
        window.location.href,
      )?.toLowerCase();

      if (!targetHandle) {
        return true;
      }

      if (currentHandle !== targetHandle) {
        window.location.assign(action.linkedinUrl);
        return false;
      }

      return true;
    };

    const executeAction = async (action: TwentyLinkedInAction) => {
      if (
        !canStartClaimedLinkedinAction(
          runnerState,
          action,
          isRunnerPauseRequested,
        ) &&
        runnerState.activeActionStartedAt === null
      ) {
        return;
      }

      if (!getProfileHandle(action.linkedinUrl)) {
        const reportResponse = await sendMessage('REPORT_LINKEDIN_ACTION', {
          id: action.id,
          claimedAt: action.claimedAt,
          status: 'FAILED',
          connectionState: 'UNKNOWN',
          executedAt: new Date().toISOString(),
          errorMessage:
            'The action did not contain a valid LinkedIn profile URL',
        });

        if (!reportResponse.success) {
          throw new Error(
            reportResponse.error || 'Could not report the invalid action URL',
          );
        }

        await Promise.all([refreshRunnerState(), refreshQueue()]);
        statusMessage =
          'The action did not contain a valid LinkedIn profile URL.';
        statusIsError = true;
        render();
        return;
      }

      const isRecoveringAction =
        canRecoverLinkedInActionAfterInterruption(action.type) &&
        (runnerState.activeActionStartedAt !== null ||
          (await wasLinkedInOutboundActionAttempted(action.id)));

      if (runnerState.activeActionStartedAt !== null && !isRecoveringAction) {
        const reportResponse = await sendMessage('REPORT_LINKEDIN_ACTION', {
          id: action.id,
          claimedAt: action.claimedAt,
          status: 'FAILED',
          connectionState: 'UNKNOWN',
          executedAt: new Date(runnerState.activeActionStartedAt).toISOString(),
          errorMessage:
            'The runner tab reloaded or stopped after this action began, so its outcome is unknown.',
        });

        if (!reportResponse.success) {
          throw new Error(
            reportResponse.error ||
              'Could not record the interrupted LinkedIn action',
          );
        }

        await Promise.all([refreshRunnerState(), refreshQueue()]);
        statusMessage =
          'The interrupted action was marked failed because its outcome is unknown.';
        statusIsError = true;
        render();
        schedulePoll(RUNNER_LOCAL_MINIMUM_GAP_MILLISECONDS);
        return;
      }

      const blockReason = getLinkedInAutomationBlockReason();

      if (blockReason) {
        await tripLinkedInSafetyCircuit(blockReason);
        await setRunnerEnabled(false);
        statusMessage = `${blockReason} The runner was stopped and the safety cooldown was activated.`;
        statusIsError = true;
        await refreshSafetySnapshot();
        render();
        return;
      }

      if (!ensureActionPage(action)) {
        statusMessage =
          'Navigating to the LinkedIn page required for the claimed action…';
        statusIsError = false;
        render();
        return;
      }

      try {
        await (isRecoveringAction
          ? assertLinkedInIdempotentRecoveryAllowed(action.id)
          : assertLinkedInOutboundAllowed(action.id));
      } catch (error) {
        if (!(error instanceof LinkedInSafetyLimitError)) {
          throw error;
        }

        statusMessage = `${error.message} Next eligible check: ${new Date(error.retryAt).toLocaleString()}.`;
        statusIsError = false;
        render();
        schedulePoll(error.retryAt - Date.now());
        return;
      }

      if (isRecoveringAction) {
        statusMessage =
          'The previous run was interrupted. Verifying LinkedIn’s current state before continuing…';
        statusIsError = false;
        render();
      } else {
        if (isRunnerPauseRequested) {
          return;
        }

        await refreshSafetySnapshot();
        statusMessage = `Preparing ${action.type.replaceAll('_', ' ').toLowerCase()}…`;
        statusIsError = false;
        render();

        // Keep the deliberate human-like delay on the unstarted side of the
        // lease boundary. The automation helper performs its remaining DOM
        // preflight before asking to mark and execute the final outbound click.
        await wait(1_200);
      }

      if (isRunnerPauseRequested) {
        return;
      }

      let result: LinkedInAutomationResult;
      let providerWasAuthorized = false;
      let providerStartRecordPromise: Promise<void> = Promise.resolve();
      const authorizeProviderOperation: LinkedInProviderOperationAuthorizer =
        async (providerOperation) => {
          if (isRunnerPauseRequested) {
            return false;
          }

          const activeClaim =
            runnerState.activeAction?.id === action.id
              ? runnerState.activeAction
              : action;

          const markResponse = await sendMessage<LinkedInRunnerSessionState>(
            'MARK_LINKEDIN_ACTION_EXECUTING',
            { id: action.id, claimedAt: activeClaim.claimedAt },
          );

          if (!markResponse.success) {
            throw new Error(
              markResponse.error || 'Could not mark the action as executing',
            );
          }

          runnerState = markResponse.data ?? runnerState;

          if (
            runnerState.activeAction?.id !== action.id ||
            runnerState.activeActionStartedAt === null
          ) {
            statusMessage =
              'The action was safely rescheduled after its provider-start checks.';
            statusIsError = false;
            await refreshQueue();
            render();
            schedulePoll(RUNNER_POLL_INTERVAL_MILLISECONDS);
            return false;
          }

          // Do not run even synchronous UI work between the accepted durable
          // start and the provider click. A cross-context crash can still make
          // the outcome ambiguous, but this keeps the controllable content-side
          // window as small as possible.
          providerWasAuthorized = invokeLinkedinProviderOperationAfterStart({
            runnerState,
            action,
            providerOperation,
          });

          if (!providerWasAuthorized) {
            throw new Error(
              'The accepted LinkedIn provider start no longer matches the active runner claim',
            );
          }

          statusMessage = `Running ${action.type.replaceAll('_', ' ').toLowerCase()}…`;
          statusIsError = false;
          render();

          providerStartRecordPromise = isRecoveringAction
            ? Promise.resolve()
            : recordLinkedInOutboundAttempt(action.id).catch((error) =>
                console.error(
                  '[Twenty] Could not persist the LinkedIn provider-start marker:',
                  error,
                ),
              );

          return true;
        };

      try {
        let providerResultPromise: Promise<LinkedInAutomationResult>;

        if (action.type === 'SEND_CONNECTION_REQUEST') {
          providerResultPromise = sendConnectionRequest(
            action.noteText ?? '',
            authorizeProviderOperation,
          );
        } else if (action.type === 'SEND_MESSAGE') {
          providerResultPromise = sendDirectMessage(
            action.noteText ?? '',
            authorizeProviderOperation,
          );
        } else {
          providerResultPromise = withdrawConnectionRequest(
            action.linkedinUrl,
            authorizeProviderOperation,
          );
        }

        result = await providerResultPromise;
        await providerStartRecordPromise;
      } catch (error) {
        if (!providerWasAuthorized) {
          throw error;
        }

        result = {
          status: 'FAILED',
          connectionState: 'UNKNOWN',
          errorMessage: `LinkedIn automation stopped unexpectedly: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }

      if (result.status === 'NAVIGATING') {
        return;
      }

      if (
        result.status === 'FAILED' &&
        /restriction|verification|unusual activity|invitation limit|commercial use limit/i.test(
          result.errorMessage,
        )
      ) {
        await tripLinkedInSafetyCircuit(result.errorMessage);
        await setRunnerEnabled(false);
        await refreshSafetySnapshot();
      }

      const reportResponse = await sendMessage('REPORT_LINKEDIN_ACTION', {
        id: action.id,
        claimedAt:
          runnerState.activeAction?.id === action.id
            ? runnerState.activeAction.claimedAt
            : action.claimedAt,
        status: result.status,
        connectionState: result.connectionState,
        executedAt: new Date(
          runnerState.activeActionStartedAt ??
            (action.claimedAt ? Date.parse(action.claimedAt) : Date.now()),
        ).toISOString(),
        errorMessage: result.status === 'FAILED' ? result.errorMessage : null,
      });

      if (!reportResponse.success) {
        throw new Error(
          reportResponse.error ||
            'The LinkedIn action ran, but its result could not be saved. The outcome is unknown.',
        );
      }

      statusMessage =
        result.status === 'FAILED'
          ? result.errorMessage
          : result.status === 'SKIPPED'
            ? 'Action skipped because LinkedIn already showed the target state.'
            : 'LinkedIn action completed.';
      statusIsError = result.status === 'FAILED';
      await Promise.all([refreshRunnerState(), refreshQueue()]);
      render();
      schedulePoll(RUNNER_LOCAL_MINIMUM_GAP_MILLISECONDS);
    };

    async function poll() {
      if (isPolling) {
        return;
      }

      isPolling = true;

      try {
        await refreshRunnerState();

        if (!runnerState.enabled) {
          statusMessage = 'Runner is paused.';
          statusIsError = false;
          render();
          return;
        }

        if (runnerState.activeAction) {
          await executeAction(runnerState.activeAction);
          return;
        }

        const minimumNextActionAt =
          (runnerState.lastExecutedAt ?? 0) +
          RUNNER_LOCAL_MINIMUM_GAP_MILLISECONDS;

        if (minimumNextActionAt > Date.now()) {
          statusMessage =
            'Waiting for the local safety gap before the next action.';
          statusIsError = false;
          render();
          schedulePoll(minimumNextActionAt - Date.now());
          return;
        }

        const dueResponse = await sendMessage<TwentyLinkedInAction[]>(
          'FETCH_DUE_LINKEDIN_ACTIONS',
        );
        const dueActions = (dueResponse.data ?? []).filter(
          (action) => new Date(action.scheduledAt).getTime() <= Date.now(),
        );

        if (!dueResponse.success) {
          throw new Error(dueResponse.error || 'Could not load due actions');
        }

        if (dueActions.length === 0) {
          await refreshQueue();
          statusMessage =
            queue.length > 0
              ? 'Waiting for the next server-scheduled action.'
              : 'No LinkedIn actions are queued.';
          statusIsError = false;
          render();
          const nextScheduledAt = queue[0]
            ? new Date(queue[0].scheduledAt).getTime()
            : Date.now() + RUNNER_POLL_INTERVAL_MILLISECONDS;

          schedulePoll(Math.max(0, nextScheduledAt - Date.now()));
          return;
        }

        let claimedAction: TwentyLinkedInAction | null = null;

        try {
          claimedAction = await claimFirstAvailableLinkedinAction(
            dueActions,
            async (dueAction) => {
              const isRecoveringAction =
                canRecoverLinkedInActionAfterInterruption(dueAction.type) &&
                (await wasLinkedInOutboundActionAttempted(dueAction.id));

              await (isRecoveringAction
                ? assertLinkedInIdempotentRecoveryAllowed(dueAction.id)
                : assertLinkedInOutboundAllowed(dueAction.id));

              const claimResponse =
                await sendMessage<TwentyLinkedInAction | null>(
                  'CLAIM_LINKEDIN_ACTION',
                  { id: dueAction.id },
                );

              if (!claimResponse.success) {
                throw new Error(
                  claimResponse.error || 'Could not claim the action',
                );
              }

              return claimResponse.data ?? null;
            },
          );
        } catch (error) {
          if (!(error instanceof LinkedInSafetyLimitError)) {
            throw error;
          }

          statusMessage = `${error.message} The action remains unclaimed. Next eligible check: ${new Date(error.retryAt).toLocaleString()}.`;
          statusIsError = false;
          await refreshSafetySnapshot();
          render();
          schedulePoll(error.retryAt - Date.now());
          return;
        }

        if (!claimedAction) {
          schedulePoll(RUNNER_POLL_INTERVAL_MILLISECONDS);
          return;
        }

        await refreshRunnerState();

        if (
          !canStartClaimedLinkedinAction(
            runnerState,
            claimedAction,
            isRunnerPauseRequested,
          )
        ) {
          statusMessage = 'Runner is paused.';
          statusIsError = false;
          render();
          return;
        }

        await executeAction(claimedAction);
      } catch (error) {
        statusMessage = error instanceof Error ? error.message : String(error);
        statusIsError = true;
        render();
        schedulePoll(RUNNER_POLL_INTERVAL_MILLISECONDS);
      } finally {
        isPolling = false;
      }
    }

    const setRunnerEnabled = async (enabled: boolean) => {
      if (!enabled) {
        isRunnerPauseRequested = true;
      }

      const response = await sendMessage<LinkedInRunnerSessionState>(
        'SET_LINKEDIN_RUNNER_STATE',
        { enabled },
      );

      if (!response.success || !response.data) {
        statusMessage = response.error || 'Could not update the runner.';
        statusIsError = true;
        render();
        return;
      }

      runnerState = response.data;

      if (enabled) {
        isRunnerPauseRequested = false;
      }
      statusMessage = enabled
        ? 'Runner started. Keep this LinkedIn tab open.'
        : 'Runner is paused.';
      statusIsError = false;
      render();

      if (enabled) {
        void poll();
      }
    };

    function render() {
      const wrapper = document.createElement('div');
      const button = document.createElement('button');
      const dot = document.createElement('span');
      const logo = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg',
      );

      button.className = 'twenty-linkedin-runner-button';
      logo.classList.add('twenty-linkedin-runner-logo');
      logo.setAttribute('viewBox', '0 0 40 40');
      logo.setAttribute('aria-hidden', 'true');
      logo.innerHTML =
        '<rect width="40" height="40" rx="4" fill="black"/><path d="M6.822 14.174c0-2.435 1.996-4.411 4.456-4.411h8.574c.125 0 .241.075.293.19a.31.31 0 0 1-.056.344l-1.88 2.023c-.326.35-.787.552-1.27.552H11.3c-.738 0-1.338.594-1.338 1.325v3.336a.78.78 0 0 1-.783.777H7.61a.78.78 0 0 1-.783-.777v-3.36zM33.5 25.553c0 2.434-1.996 4.411-4.456 4.411h-3.642c-2.46 0-4.454-1.977-4.454-4.411v-6.315c0-.43.16-.842.456-1.16l2.124-2.285a.33.33 0 0 1 .355-.081.32.32 0 0 1 .205.295v9.527c0 .73.598 1.322 1.337 1.322h3.6a1.33 1.33 0 0 0 1.337-1.322V14.197c0-.73-.599-1.325-1.337-1.325H24.84c-.481 0-.938.201-1.265.547L11.088 26.856h7.503a.78.78 0 0 1 .784.778v1.552a.78.78 0 0 1-.784.778H8.481a1.655 1.655 0 0 1-1.662-1.644v-.824c0-.412.156-.809.44-1.114l13.999-15.06a4.9 4.9 0 0 1 3.594-1.56h4.189c2.46 0 4.454 1.977 4.454 4.412v11.379z" fill="white"/>';
      dot.className = `twenty-linkedin-runner-dot${
        runnerState.enabled || isHarvestSyncing ? ' is-running' : ''
      }`;
      button.append(logo, dot, document.createTextNode('Runner'));
      button.addEventListener('click', () => {
        isPanelOpen = !isPanelOpen;
        render();
      });
      wrapper.appendChild(button);

      if (isPanelOpen) {
        const panel = document.createElement('div');
        panel.className = 'twenty-linkedin-runner-panel';
        const nextAction = queue[0];
        const nextActionLabel = nextAction
          ? new Date(nextAction.scheduledAt).toLocaleString()
          : 'None scheduled';
        const lastHarvestLabel = harvestSyncState?.lastRunAt
          ? new Date(harvestSyncState.lastRunAt).toLocaleString()
          : 'No completed sync yet';
        const progressLabel =
          isHarvestSyncing || isHarvestOwnedByAnotherTab
            ? `Processed this run: ${harvestProgress.connections} connections, ${harvestProgress.invitations} invites, ${harvestProgress.threads} threads, ${harvestProgress.messages} messages.`
            : '';
        const cooldownLabel = safetySnapshot.cooldownUntil
          ? `Paused until ${new Date(safetySnapshot.cooldownUntil).toLocaleString()}: ${safetySnapshot.cooldownReason ?? 'LinkedIn returned a safety signal.'}`
          : null;
        const nextOutboundLabel = safetySnapshot.nextOutboundAt
          ? new Date(safetySnapshot.nextOutboundAt).toLocaleString()
          : 'Now';
        const outboundSafetyLabel = `${safetySnapshot.outboundAttemptsToday} today · Eligible: ${nextOutboundLabel} · Consecutive gap always on`;
        const dailyReadLimitLabel = safetySnapshot.dailyReadLimitEnabled
          ? `${safetySnapshot.readRequestsToday}/${safetySnapshot.dailyReadLimit} today`
          : `${safetySnapshot.readRequestsToday} today · Daily cap off for testing`;

        panel.innerHTML = `
          <div class="twenty-linkedin-runner-header">
            <span class="twenty-linkedin-runner-title">Twenty LinkedIn runner</span>
            <button class="twenty-linkedin-runner-close" aria-label="Close">×</button>
          </div>
          <div class="twenty-linkedin-runner-body">
            <div class="twenty-linkedin-runner-section-title">Outbound actions</div>
            <div class="twenty-linkedin-runner-stats">
              <div class="twenty-linkedin-runner-stat"><strong>${queue.length}</strong>Pending</div>
              <div class="twenty-linkedin-runner-stat"><strong>${runnerState.completedCount}</strong>Completed</div>
              <div class="twenty-linkedin-runner-stat"><strong>${runnerState.failedCount}</strong>Failed</div>
              <div class="twenty-linkedin-runner-stat"><strong>${runnerState.activeAction ? '1' : '0'}</strong>Claimed</div>
            </div>
            <div class="twenty-linkedin-runner-meta">
              <div class="twenty-linkedin-runner-status">Next: ${escapeHtml(nextActionLabel)}</div>
              <div class="twenty-linkedin-runner-status">${escapeHtml(outboundSafetyLabel)}</div>
            </div>
            ${cooldownLabel ? `<div class="twenty-linkedin-runner-status is-error">${escapeHtml(cooldownLabel)}</div>` : ''}
            <div class="twenty-linkedin-runner-status${statusIsError ? ' is-error' : ''}">${escapeHtml(statusMessage)}</div>
            <button class="twenty-linkedin-runner-action${runnerState.enabled ? ' is-pause' : ''}" data-action="runner">${runnerState.enabled ? 'Pause runner' : 'Start runner'}</button>
            <div class="twenty-linkedin-runner-divider"></div>
            <div class="twenty-linkedin-runner-section-title">Read-only LinkedIn sync</div>
            <div class="twenty-linkedin-runner-stats">
              <div class="twenty-linkedin-runner-stat"><strong>${harvestTotals.connections}</strong>Connections</div>
              <div class="twenty-linkedin-runner-stat"><strong>${harvestTotals.invitations}</strong>Invites</div>
              <div class="twenty-linkedin-runner-stat"><strong>${harvestTotals.threads}</strong>Threads</div>
              <div class="twenty-linkedin-runner-stat"><strong>${harvestTotals.messages}</strong>Messages</div>
            </div>
            <div class="twenty-linkedin-runner-meta">
              <div class="twenty-linkedin-runner-status">Last completed sync: ${escapeHtml(lastHarvestLabel)}</div>
              <div class="twenty-linkedin-runner-status">Read budget: ${safetySnapshot.readRequestsLastHour}/${LINKEDIN_READ_REQUESTS_PER_HOUR} in the last hour · ${escapeHtml(dailyReadLimitLabel)}.</div>
            </div>
            ${progressLabel ? `<div class="twenty-linkedin-runner-status">${escapeHtml(progressLabel)}</div>` : ''}
            <p class="twenty-linkedin-runner-sync-copy">Sync every 30 mins</p>
            <div class="twenty-linkedin-runner-status${harvestStatusIsError ? ' is-error' : ''}">${escapeHtml(harvestStatusMessage)}</div>
            <button class="twenty-linkedin-runner-action is-harvest" data-action="sync" ${isHarvestSyncing || isHarvestOwnedByAnotherTab ? 'disabled' : ''}>${isHarvestSyncing || isHarvestOwnedByAnotherTab ? 'Syncing…' : 'Sync now'}</button>
          </div>
        `;

        panel
          .querySelector('.twenty-linkedin-runner-close')
          ?.addEventListener('click', () => {
            isPanelOpen = false;
            render();
          });
        panel
          .querySelector('[data-action="runner"]')
          ?.addEventListener(
            'click',
            () => void setRunnerEnabled(!runnerState.enabled),
          );
        panel
          .querySelector('[data-action="sync"]')
          ?.addEventListener('click', () => void syncAllHarvestData(true));
        wrapper.appendChild(panel);
      }

      root.replaceChildren(wrapper);
    }

    const runtimeMessageListener = (message: {
      type?: string;
      force?: boolean;
    }) => {
      if (message.type === 'RUN_LINKEDIN_POLL') {
        void poll();
      } else if (message.type === 'RUN_LINKEDIN_SYNC') {
        void syncAllHarvestData(message.force === true);
      }
    };

    browser.runtime.onMessage.addListener(runtimeMessageListener);

    void (async () => {
      try {
        harvestIdentity = await getCachedLinkedInIdentity();

        await Promise.all([refreshRunnerState(), refreshQueue()]);

        if (harvestIdentity) {
          harvestSyncState = await getLinkedInSyncState(
            harvestIdentity.linkedinId,
          );
        }

        await Promise.all([refreshHarvestTotals(), refreshSafetySnapshot()]);
        harvestStatusMessage = 'Waiting for the next automatic sync.';
      } catch (error) {
        statusMessage = error instanceof Error ? error.message : String(error);
        statusIsError = true;
        harvestStatusMessage = statusMessage;
        harvestStatusIsError = true;
      }

      render();

      autoSyncInterval = setInterval(() => {
        void syncAllHarvestData();
      }, HARVEST_AUTO_SYNC_INTERVAL_MILLISECONDS);
      lockStatusInterval = setInterval(
        () => void refreshHarvestLockStatus(),
        HARVEST_LOCK_STATUS_INTERVAL_MILLISECONDS,
      );
      totalsInterval = setInterval(
        () =>
          void Promise.all([refreshHarvestTotals(), refreshSafetySnapshot()])
            .then(render)
            .catch(() => undefined),
        HARVEST_TOTALS_INTERVAL_MILLISECONDS,
      );

      if (runnerState.enabled) {
        void poll();
      }

      void syncAllHarvestData();
    })();

    ctx.onInvalidated(() => {
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
      }
      if (lockStatusInterval) {
        clearInterval(lockStatusInterval);
      }
      if (totalsInterval) {
        clearInterval(totalsInterval);
      }
      void releaseHarvestLock();
      browser.runtime.onMessage.removeListener(runtimeMessageListener);
      root.remove();
      style.remove();
    });
  },
});
