import type {
  ExtensionResponse,
  LinkedInRunnerSessionState,
  TwentyLinkedInAction,
} from '../types';
import {
  sendConnectionRequest,
  withdrawConnectionRequest,
  type LinkedInAutomationResult,
} from '../utils/linkedin-automation';

const RUNNER_LOCAL_MINIMUM_GAP_MILLISECONDS = 60_000;
const RUNNER_POLL_INTERVAL_MILLISECONDS = 60_000;
const LINKEDIN_INVITATION_MANAGER_PATH = '/mynetwork/invitation-manager/sent/';

const RUNNER_STYLES = `
  .twenty-linkedin-runner-root {
    bottom: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    position: fixed;
    right: 24px;
    z-index: 99998;
  }

  .twenty-linkedin-runner-button {
    align-items: center;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border: none;
    border-radius: 24px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    color: white;
    cursor: pointer;
    display: flex;
    font-size: 13px;
    font-weight: 700;
    gap: 8px;
    padding: 11px 16px;
  }

  .twenty-linkedin-runner-logo {
    height: 18px;
    width: 18px;
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
    bottom: 52px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
    color: #1f2937;
    overflow: hidden;
    position: absolute;
    right: 0;
    width: 340px;
  }

  .twenty-linkedin-runner-header {
    align-items: center;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    padding: 12px 16px;
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
    gap: 12px;
    padding: 16px;
  }

  .twenty-linkedin-runner-stats {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, 1fr);
  }

  .twenty-linkedin-runner-stat {
    background: #f3f4f6;
    border-radius: 8px;
    font-size: 12px;
    padding: 10px;
  }

  .twenty-linkedin-runner-stat strong {
    display: block;
    font-size: 16px;
    margin-bottom: 2px;
  }

  .twenty-linkedin-runner-warning,
  .twenty-linkedin-runner-status {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    color: #92400e;
    font-size: 12px;
    line-height: 1.4;
    padding: 10px;
  }

  .twenty-linkedin-runner-status {
    background: #f9fafb;
    border-color: #e5e7eb;
    color: #4b5563;
  }

  .twenty-linkedin-runner-status.is-error {
    background: #fef2f2;
    border-color: #fecaca;
    color: #991b1b;
  }

  .twenty-linkedin-runner-action {
    background: #6366f1;
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 10px 14px;
    width: 100%;
  }

  .twenty-linkedin-runner-action.is-pause {
    background: #374151;
  }
`;

const defaultRunnerState = (): LinkedInRunnerSessionState => ({
  enabled: false,
  tabId: null,
  activeAction: null,
  activeActionStartedAt: null,
  lastExecutedAt: null,
  completedCount: 0,
  failedCount: 0,
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
    let queue: TwentyLinkedInAction[] = [];
    let isPanelOpen = false;
    let isPolling = false;
    let statusMessage = 'Runner is paused.';
    let statusIsError = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
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
      if (action.type === 'WITHDRAW_CONNECTION_REQUEST') {
        if (
          !window.location.pathname.startsWith(LINKEDIN_INVITATION_MANAGER_PATH)
        ) {
          window.location.assign(
            `${window.location.origin}${LINKEDIN_INVITATION_MANAGER_PATH}`,
          );
          return false;
        }

        return true;
      }

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
        action.type === 'SEND_CONNECTION_REQUEST' &&
        !getProfileHandle(action.linkedinUrl)
      ) {
        const reportResponse = await sendMessage('REPORT_LINKEDIN_ACTION', {
          id: action.id,
          status: 'FAILED',
          connectionState: 'UNKNOWN',
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

      if (!ensureActionPage(action)) {
        statusMessage =
          'Navigating to the LinkedIn page required for the claimed action…';
        statusIsError = false;
        render();
        return;
      }

      if (runnerState.activeActionStartedAt) {
        statusMessage =
          'This tab closed or reloaded after the action started. Its outcome is unknown; Twenty will not retry it silently.';
        statusIsError = true;
        render();
        return;
      }

      const markResponse = await sendMessage<LinkedInRunnerSessionState>(
        'MARK_LINKEDIN_ACTION_EXECUTING',
        { id: action.id },
      );

      if (!markResponse.success) {
        throw new Error(
          markResponse.error || 'Could not mark the action as executing',
        );
      }

      runnerState = markResponse.data ?? runnerState;
      statusMessage = `Running ${action.type.replaceAll('_', ' ').toLowerCase()}…`;
      statusIsError = false;
      render();
      await wait(1_200);

      let result: LinkedInAutomationResult;

      if (action.type === 'SEND_CONNECTION_REQUEST') {
        result = await sendConnectionRequest(action.noteText);
      } else {
        result = await withdrawConnectionRequest(action.linkedinUrl);
      }

      if (result.status === 'NAVIGATING') {
        return;
      }

      const reportResponse = await sendMessage('REPORT_LINKEDIN_ACTION', {
        id: action.id,
        status: result.status,
        connectionState: result.connectionState,
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
        const dueAction = dueResponse.data?.find(
          (action) => new Date(action.scheduledAt).getTime() <= Date.now(),
        );

        if (!dueResponse.success) {
          throw new Error(dueResponse.error || 'Could not load due actions');
        }

        if (!dueAction) {
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

        const claimResponse = await sendMessage<TwentyLinkedInAction | null>(
          'CLAIM_LINKEDIN_ACTION',
          { id: dueAction.id },
        );

        if (!claimResponse.success) {
          throw new Error(claimResponse.error || 'Could not claim the action');
        }

        if (!claimResponse.data) {
          schedulePoll(RUNNER_POLL_INTERVAL_MILLISECONDS);
          return;
        }

        await refreshRunnerState();
        await executeAction(claimResponse.data);
      } catch (error) {
        statusMessage = error instanceof Error ? error.message : String(error);
        statusIsError = true;
        render();
      } finally {
        isPolling = false;
      }
    }

    const setRunnerEnabled = async (enabled: boolean) => {
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
        '<rect width="40" height="40" rx="8" fill="white" fill-opacity="0.18"/><path d="M12 14h16v3H12zM12 20h12v3H12zM12 26h8v3H12z" fill="white"/>';
      dot.className = `twenty-linkedin-runner-dot${
        runnerState.enabled ? ' is-running' : ''
      }`;
      button.append(logo, dot, document.createTextNode('Twenty runner'));
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

        panel.innerHTML = `
          <div class="twenty-linkedin-runner-header">
            <span class="twenty-linkedin-runner-title">Twenty LinkedIn runner</span>
            <button class="twenty-linkedin-runner-close" aria-label="Close">×</button>
          </div>
          <div class="twenty-linkedin-runner-body">
            <div class="twenty-linkedin-runner-stats">
              <div class="twenty-linkedin-runner-stat"><strong>${queue.length}</strong>Pending</div>
              <div class="twenty-linkedin-runner-stat"><strong>${runnerState.completedCount}</strong>Completed</div>
              <div class="twenty-linkedin-runner-stat"><strong>${runnerState.failedCount}</strong>Failed</div>
              <div class="twenty-linkedin-runner-stat"><strong>${runnerState.activeAction ? '1' : '0'}</strong>Claimed</div>
            </div>
            <div class="twenty-linkedin-runner-status">Next scheduled: ${escapeHtml(nextActionLabel)}</div>
            <div class="twenty-linkedin-runner-warning">Keep this tab open. LinkedIn automation can put your account at risk; Twenty uses the server schedule and a local safety gap, but cannot remove that risk.</div>
            <div class="twenty-linkedin-runner-status${statusIsError ? ' is-error' : ''}">${escapeHtml(statusMessage)}</div>
            <button class="twenty-linkedin-runner-action${runnerState.enabled ? ' is-pause' : ''}">${runnerState.enabled ? 'Pause runner' : 'Start runner'}</button>
          </div>
        `;

        panel
          .querySelector('.twenty-linkedin-runner-close')
          ?.addEventListener('click', () => {
            isPanelOpen = false;
            render();
          });
        panel
          .querySelector('.twenty-linkedin-runner-action')
          ?.addEventListener(
            'click',
            () => void setRunnerEnabled(!runnerState.enabled),
          );
        wrapper.appendChild(panel);
      }

      root.replaceChildren(wrapper);
    }

    const runtimeMessageListener = (message: { type?: string }) => {
      if (message.type === 'RUN_LINKEDIN_POLL') {
        void poll();
      }
    };

    browser.runtime.onMessage.addListener(runtimeMessageListener);

    void (async () => {
      try {
        await Promise.all([refreshRunnerState(), refreshQueue()]);
      } catch (error) {
        statusMessage = error instanceof Error ? error.message : String(error);
        statusIsError = true;
      }

      render();

      if (runnerState.enabled) {
        void poll();
      }
    })();

    ctx.onInvalidated(() => {
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
      browser.runtime.onMessage.removeListener(runtimeMessageListener);
      root.remove();
      style.remove();
    });
  },
});
