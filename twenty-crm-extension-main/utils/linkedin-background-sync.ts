import type { LinkedInHarvestInvitation } from '../types';
import type { LinkedInHarvestStore } from './linkedin-harvest-store';
import {
  getLinkedInSafetySnapshot,
  LinkedInSafetyLimitError,
} from './linkedin-safety';
import { LINKEDIN_READ_REQUESTS_PER_HOUR } from './linkedin-safety-policy';
import {
  backfillLinkedInConnections,
  syncLinkedInInvitations,
  syncRecentLinkedInConnections,
} from './linkedin-sync-connections';
import {
  backfillLinkedInMessages,
  syncRecentLinkedInMessages,
} from './linkedin-sync-messages';
import {
  emptyLinkedInSyncStatus,
  getLinkedInSyncState,
  getStoredLinkedInIdentity,
  LINKEDIN_CONNECTION_SYNC_INTERVAL_MINUTES,
  LINKEDIN_IDENTITY_REVALIDATION_MILLISECONDS,
  LINKEDIN_MAINTENANCE_INTERVAL_MINUTES,
  LINKEDIN_SYNC_INTERVAL_MINUTES,
  setCachedLinkedInIdentity,
  updateLinkedInSyncState,
} from './linkedin-sync-state';
import {
  linkedInVoyagerClient,
  LinkedInSyncTimeLimitError,
} from './linkedin-voyager-client';
import { TWENTY_SIGN_IN_REQUIRED } from './twenty-session';

const HARVEST_MAINTENANCE_GAP_MILLISECONDS =
  LINKEDIN_MAINTENANCE_INTERVAL_MINUTES * 60_000;
// Same alarm-jitter allowance as the run gap so hourly work does not slip to two hours.
const CONNECTION_SYNC_GAP_MILLISECONDS =
  (LINKEDIN_CONNECTION_SYNC_INTERVAL_MINUTES - 1) * 60_000;
// Allow alarm jitter and session checks without skipping every other alarm.
const MINIMUM_SYNC_GAP_MILLISECONDS =
  (LINKEDIN_SYNC_INTERVAL_MINUTES - 1) * 60_000;
const SYNC_STATUS_STORAGE_KEY = 'twentyLinkedinBackgroundSyncStatus';
const SYNC_TIME_BUDGET_MILLISECONDS = 180_000;

export const createLinkedInBackgroundSync = (
  getStore: () => Promise<LinkedInHarvestStore>,
  readReceivedInvitations: () => Promise<LinkedInHarvestInvitation[]>,
) => {
  const status = emptyLinkedInSyncStatus();

  const getStatus = async () => {
    if (status.running) return status;

    const stored = await browser.storage.local.get(SYNC_STATUS_STORAGE_KEY);
    const previous = stored[SYNC_STATUS_STORAGE_KEY] as
      | Pick<typeof status, 'message' | 'isError'>
      | undefined;
    return { ...status, ...previous };
  };

  const run = async (force = false): Promise<void> => {
    if (status.running) return;

    status.running = true;
    let activeOwnerLinkedinId: string | undefined;
    let attempted = false;

    try {
      const cachedIdentity = await getStoredLinkedInIdentity();
      if (!force && cachedIdentity) {
        const state = await getLinkedInSyncState(cachedIdentity.linkedinId);
        if (
          Date.now() - (state.lastAttemptAt ?? 0) <
          MINIMUM_SYNC_GAP_MILLISECONDS
        )
          return;
      }

      attempted = true;
      status.isError = false;
      status.progress = emptyLinkedInSyncStatus().progress;
      status.message = 'Preparing LinkedIn sync…';

      const safety = await getLinkedInSafetySnapshot();
      if (safety.cooldownUntil !== null && safety.cooldownUntil > Date.now()) {
        status.message = `${safety.cooldownReason ?? 'LinkedIn paused sync.'} Sync resumes after ${new Date(safety.cooldownUntil).toLocaleString()}.`;
        status.isError = true;
        return;
      }
      if (
        safety.readRequestsLastHour >= LINKEDIN_READ_REQUESTS_PER_HOUR ||
        (safety.dailyReadLimitEnabled &&
          safety.readRequestsToday >= safety.dailyReadLimit)
      ) {
        status.message =
          'LinkedIn read limit reached. Sync will resume automatically.';
        return;
      }

      const store = await getStore();
      await linkedInVoyagerClient.initialize(
        Date.now() + SYNC_TIME_BUDGET_MILLISECONDS,
      );
      const sessionFingerprint = linkedInVoyagerClient.getSessionFingerprint();
      // Re-reading /me on every check spent a fifth of the daily read budget.
      const identity =
        !force &&
        cachedIdentity &&
        sessionFingerprint !== null &&
        cachedIdentity.sessionFingerprint === sessionFingerprint &&
        Date.now() - (cachedIdentity.verifiedAt ?? 0) <
          LINKEDIN_IDENTITY_REVALIDATION_MILLISECONDS
          ? cachedIdentity
          : await linkedInVoyagerClient.getIdentity();
      const ownerLinkedinId = identity.linkedinId;
      activeOwnerLinkedinId = ownerLinkedinId;
      if (identity !== cachedIdentity) {
        await setCachedLinkedInIdentity({
          ...identity,
          verifiedAt: Date.now(),
          sessionFingerprint,
        });
      }
      const runStartedAt = Date.now();
      let syncState = await updateLinkedInSyncState(ownerLinkedinId, {
        syncStartedAt: runStartedAt,
        lastAttemptAt: runStartedAt,
        lastError: null,
      });
      status.message = 'Syncing LinkedIn data…';
      const errors: string[] = [];
      const warnings: string[] = [];
      const runPhase = async (
        operation: () => Promise<void>,
      ): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          if (
            error instanceof LinkedInSafetyLimitError ||
            error instanceof LinkedInSyncTimeLimitError ||
            (error instanceof Error &&
              error.message === TWENTY_SIGN_IN_REQUIRED)
          ) {
            throw error;
          }
          errors.push(error instanceof Error ? error.message : String(error));
        }
      };

      // Messages go first: they are the most time-sensitive and must not lose
      // the remaining read budget to connection checks.
      await runPhase(async () => {
        await syncRecentLinkedInMessages(store, identity, status.progress);
        await updateLinkedInSyncState(ownerLinkedinId, {
          lastMessageSyncAt: Date.now(),
        });
      });
      if (
        force ||
        runStartedAt - (syncState.lastConnectionSyncAt ?? 0) >=
          CONNECTION_SYNC_GAP_MILLISECONDS
      ) {
        await runPhase(async () => {
          await syncRecentLinkedInConnections(
            store,
            ownerLinkedinId,
            runStartedAt,
            status.progress,
          );
          await updateLinkedInSyncState(ownerLinkedinId, {
            lastConnectionSyncAt: Date.now(),
          });
        });
      }

      // Publish recent progress before lower-priority work takes the read budget.
      if (errors.length === 0) {
        syncState = await updateLinkedInSyncState(ownerLinkedinId, {
          lastRunAt: Date.now(),
        });
        status.message = 'Recent LinkedIn messages and connections synced.';
      }

      if (
        force ||
        runStartedAt - (syncState.lastInvitationAttemptAt ?? 0) >=
          HARVEST_MAINTENANCE_GAP_MILLISECONDS
      ) {
        await updateLinkedInSyncState(ownerLinkedinId, {
          lastInvitationAttemptAt: runStartedAt,
        });
        await runPhase(async () => {
          const result = await syncLinkedInInvitations(
            store,
            ownerLinkedinId,
            runStartedAt,
            status.progress,
            readReceivedInvitations,
          );
          warnings.push(...result.warnings);
        });
      }

      await runPhase(() =>
        backfillLinkedInConnections(
          store,
          ownerLinkedinId,
          runStartedAt,
          status.progress,
        ),
      );

      if (
        force ||
        !syncState.historicalBackfillComplete ||
        runStartedAt - (syncState.lastMessageBackfillAttemptAt ?? 0) >=
          HARVEST_MAINTENANCE_GAP_MILLISECONDS
      ) {
        await updateLinkedInSyncState(ownerLinkedinId, {
          lastMessageBackfillAttemptAt: runStartedAt,
        });
        await runPhase(() =>
          backfillLinkedInMessages(store, identity, status.progress),
        );
      }

      if (errors.length > 0) throw new Error([...new Set(errors)].join('; '));
      status.message =
        warnings.length > 0
          ? `LinkedIn sync completed. ${warnings.join(' ')}`
          : 'LinkedIn sync completed.';
    } catch (error) {
      status.message = error instanceof Error ? error.message : String(error);
      status.isError =
        !(error instanceof LinkedInSyncTimeLimitError) &&
        !/read limit reached/i.test(status.message);
    } finally {
      try {
        if (attempted) {
          await browser.storage.local.set({
            [SYNC_STATUS_STORAGE_KEY]: {
              message: status.message,
              isError: status.isError,
            },
          });
        }
        if (activeOwnerLinkedinId) {
          await updateLinkedInSyncState(activeOwnerLinkedinId, {
            syncStartedAt: null,
            lastError: status.isError ? status.message : null,
          });
        }
      } catch (error) {
        console.error('[Twenty] Could not save LinkedIn sync status:', error);
      } finally {
        status.running = false;
      }
    }
  };

  return { getStatus, run };
};
