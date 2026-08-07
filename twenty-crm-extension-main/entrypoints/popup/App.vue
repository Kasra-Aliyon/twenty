<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import type {
  ExtensionResponse,
  LinkedInSafetySettings,
  LinkedInSafetySnapshot,
  LinkedInSyncTotals,
} from '../../types';
import { LINKEDIN_READ_REQUESTS_PER_DAY } from '../../utils/linkedin-safety-policy';
import {
  DEFAULT_TWENTY_API_URL,
  DEFAULT_TWENTY_APP_URL,
} from '../../utils/storage';

// State
const twentyAppUrl = ref(DEFAULT_TWENTY_APP_URL);
const twentyApiUrl = ref(DEFAULT_TWENTY_API_URL);
const hasToken = ref(false);
const isConnected = ref(false);
const isLoading = ref(true);
const isSaving = ref(false);
const isTesting = ref(false);
const isLinkedInSyncing = ref(false);
const isSavingLinkedInSafetySetting = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
const linkedInSyncTotals = ref<LinkedInSyncTotals>({
  connections: 0,
  invitations: 0,
  threads: 0,
  messages: 0,
});
const linkedInSafetySnapshot = ref<LinkedInSafetySnapshot | null>(null);
const linkedInDailyReadLimitEnabled = ref(false);
const recentCaptures = ref<
  Array<{
    linkedinUrl: string;
    name: string;
    type: 'person' | 'company';
    capturedAt: number;
    twentyId: string;
  }>
>([]);

// Computed
const isConfigured = computed(
  () => !!twentyAppUrl.value && !!twentyApiUrl.value,
);
const connectionStatus = computed(() => {
  if (!isConfigured.value) return 'not-configured';
  if (!hasToken.value) return 'no-session';
  if (isConnected.value) return 'connected';
  return 'disconnected';
});

const statusText = computed(() => {
  switch (connectionStatus.value) {
    case 'not-configured':
      return 'Not configured';
    case 'no-session':
      return 'Not logged in';
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Connection failed';
    default:
      return 'Unknown';
  }
});

const statusClass = computed(() => {
  switch (connectionStatus.value) {
    case 'connected':
      return 'status--connected';
    case 'no-session':
      return 'status--warning';
    default:
      return 'status--error';
  }
});

// Load settings on mount
onMounted(async () => {
  await loadSettings();
  await loadRecentCaptures();
  await loadLinkedInSyncTotals();
  await loadLinkedInSafetySnapshot();
});

async function loadSettings() {
  isLoading.value = true;
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_SETTINGS',
    })) as ExtensionResponse<{
      twentyAppUrl: string;
      twentyApiUrl: string;
      hasToken: boolean;
    }>;

    if (response.success && response.data) {
      twentyAppUrl.value = response.data.twentyAppUrl || DEFAULT_TWENTY_APP_URL;
      twentyApiUrl.value = response.data.twentyApiUrl || DEFAULT_TWENTY_API_URL;
      hasToken.value = response.data.hasToken || false;

      if (hasToken.value) {
        await testConnection();
      }
    }
  } catch (err) {
    console.error('Error loading settings:', err);
    error.value = 'Failed to load settings';
  } finally {
    isLoading.value = false;
  }
}

async function loadRecentCaptures() {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_RECENT_CAPTURES',
    })) as ExtensionResponse<typeof recentCaptures.value>;

    if (response.success && response.data) {
      recentCaptures.value = response.data;
    }
  } catch (err) {
    console.error('Error loading recent captures:', err);
  }
}

async function loadLinkedInSyncTotals() {
  if (!hasToken.value) {
    return;
  }

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_LINKEDIN_SYNC_TOTALS',
    })) as ExtensionResponse<LinkedInSyncTotals>;

    if (response.success && response.data) {
      linkedInSyncTotals.value = response.data;
    }
  } catch (err) {
    console.error('Error loading LinkedIn sync totals:', err);
  }
}

async function loadLinkedInSafetySnapshot() {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_LINKEDIN_SAFETY_SNAPSHOT',
    })) as ExtensionResponse<LinkedInSafetySnapshot>;

    if (response.success && response.data) {
      linkedInSafetySnapshot.value = response.data;
      linkedInDailyReadLimitEnabled.value = response.data.dailyReadLimitEnabled;
    }
  } catch (err) {
    console.error('Error loading LinkedIn safety status:', err);
  }
}

async function saveLinkedInDailyReadLimitEnabled() {
  isSavingLinkedInSafetySetting.value = true;
  error.value = null;

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'SET_LINKEDIN_SAFETY_SETTINGS',
      payload: {
        dailyReadLimitEnabled: linkedInDailyReadLimitEnabled.value,
      },
    })) as ExtensionResponse<LinkedInSafetySettings>;

    if (!response.success || !response.data) {
      error.value = response.error || 'Could not save the daily read limit';
      return;
    }

    linkedInDailyReadLimitEnabled.value = response.data.dailyReadLimitEnabled;
    await loadLinkedInSafetySnapshot();
  } catch (err) {
    console.error('Error saving LinkedIn safety settings:', err);
    error.value = 'Could not save the daily read limit';
  } finally {
    isSavingLinkedInSafetySetting.value = false;
  }
}

async function syncLinkedInNow() {
  isLinkedInSyncing.value = true;
  error.value = null;
  success.value = null;

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'REQUEST_LINKEDIN_SYNC',
    })) as ExtensionResponse<{ dispatched: boolean }>;

    if (!response.success) {
      error.value = response.error || 'Could not start LinkedIn sync';
      return;
    }

    success.value =
      'Sync started. Stored totals will update as incremental writes finish.';
    window.setTimeout(() => {
      void Promise.all([
        loadLinkedInSyncTotals(),
        loadLinkedInSafetySnapshot(),
      ]);
    }, 5_000);
  } catch (err) {
    console.error('Error starting LinkedIn sync:', err);
    error.value = 'Could not start LinkedIn sync';
  } finally {
    isLinkedInSyncing.value = false;
  }
}

function normalizeUrl(url: string): string {
  let normalizedUrl = url.trim();

  if (
    !normalizedUrl.startsWith('http://') &&
    !normalizedUrl.startsWith('https://')
  ) {
    normalizedUrl = 'http://' + normalizedUrl;
  }

  return normalizedUrl.replace(/\/$/, '');
}

async function saveSettings() {
  if (!twentyAppUrl.value || !twentyApiUrl.value) {
    error.value = 'Please enter your Twenty app and API URLs';
    return;
  }

  const normalizedTwentyAppUrl = normalizeUrl(twentyAppUrl.value);
  const normalizedTwentyApiUrl = normalizeUrl(twentyApiUrl.value);

  twentyAppUrl.value = normalizedTwentyAppUrl;
  twentyApiUrl.value = normalizedTwentyApiUrl;

  isSaving.value = true;
  error.value = null;
  success.value = null;

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: {
        twentyAppUrl: normalizedTwentyAppUrl,
        twentyApiUrl: normalizedTwentyApiUrl,
      },
    })) as ExtensionResponse;

    if (response.success) {
      success.value = 'Settings saved!';
      // Reload to check token
      await loadSettings();
    } else {
      error.value = response.error || 'Failed to save settings';
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    error.value = 'Failed to save settings';
  } finally {
    isSaving.value = false;
    setTimeout(() => {
      success.value = null;
    }, 3000);
  }
}

async function testConnection() {
  isTesting.value = true;
  error.value = null;

  try {
    const authResponse = (await browser.runtime.sendMessage({
      type: 'GET_AUTH_TOKEN',
    })) as ExtensionResponse<{ hasToken: boolean }>;

    hasToken.value =
      authResponse.success && authResponse.data?.hasToken === true;

    if (!hasToken.value) {
      const syncResponse = (await browser.runtime.sendMessage({
        type: 'SYNC_TWENTY_TOKEN_PAIR_FROM_ACTIVE_TAB',
      })) as ExtensionResponse<{ hasToken: boolean }>;

      hasToken.value =
        syncResponse.success && syncResponse.data?.hasToken === true;
    }

    if (!hasToken.value) {
      isConnected.value = false;
      error.value =
        'No local Twenty login token synced yet. Open http://localhost:2001, log in, then click this extension while that Twenty tab is active.';
      return;
    }

    const response = (await browser.runtime.sendMessage({
      type: 'TEST_CONNECTION',
    })) as ExtensionResponse<{ connected: boolean }>;

    isConnected.value = response.success && response.data?.connected === true;

    if (!isConnected.value) {
      error.value = 'Connection test failed. Check your URL and login.';
    }
  } catch (err) {
    console.error('Error testing connection:', err);
    isConnected.value = false;
    error.value = 'Connection test failed';
  } finally {
    isTesting.value = false;
  }
}

function openTwenty() {
  if (twentyAppUrl.value) {
    browser.tabs.create({ url: twentyAppUrl.value });
  }
}

function openRecord(record: { twentyId: string; type: string }) {
  if (twentyAppUrl.value) {
    // URL uses singular: /object/person/ and /object/company/
    browser.tabs.create({
      url: `${twentyAppUrl.value}/object/${record.type}/${record.twentyId}`,
    });
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}
</script>

<template>
  <div class="popup">
    <!-- Header -->
    <header class="header">
      <div class="header__logo">
        <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
          <rect width="40" height="40" rx="8" fill="#6366f1" />
          <path d="M12 14h16v3H12zM12 20h12v3H12zM12 26h8v3H12z" fill="white" />
        </svg>
        <span class="header__title">Twenty CRM</span>
      </div>
      <div :class="['status-badge', statusClass]">
        <span class="status-dot"></span>
        {{ statusText }}
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading">
      <div class="spinner"></div>
      <span>Loading...</span>
    </div>

    <!-- Main Content -->
    <main v-else class="content">
      <!-- Settings Section -->
      <section class="section">
        <h2 class="section__title">Settings</h2>

        <div class="form-group">
          <label class="label" for="twentyAppUrl">Twenty App URL</label>
          <input
            id="twentyAppUrl"
            v-model="twentyAppUrl"
            type="url"
            class="input"
            placeholder="http://localhost:2001"
            @keyup.enter="saveSettings"
          />
          <p class="hint">Local Twenty frontend URL for opening records</p>
        </div>

        <div class="form-group">
          <label class="label" for="twentyApiUrl">Twenty API URL</label>
          <input
            id="twentyApiUrl"
            v-model="twentyApiUrl"
            type="url"
            class="input"
            placeholder="http://localhost:2000"
            @keyup.enter="saveSettings"
          />
          <p class="hint">Local Twenty server URL used for GraphQL</p>
        </div>

        <div class="button-group">
          <button
            class="btn btn--primary"
            :disabled="isSaving"
            @click="saveSettings"
          >
            {{ isSaving ? 'Saving...' : 'Save' }}
          </button>
          <button
            class="btn btn--secondary"
            :disabled="isTesting || !isConfigured"
            @click="testConnection"
          >
            {{ isTesting ? 'Testing...' : 'Test Connection' }}
          </button>
        </div>

        <!-- Messages -->
        <div v-if="error" class="message message--error">
          {{ error }}
        </div>
        <div v-if="success" class="message message--success">
          {{ success }}
        </div>
      </section>

      <!-- Login Prompt -->
      <section
        v-if="isConfigured && !hasToken"
        class="section section--warning"
      >
        <p class="warning-text">
          Please log in to local Twenty to sync your browser session.
        </p>
        <button class="btn btn--primary" @click="openTwenty">
          Open Twenty →
        </button>
      </section>

      <section v-if="hasToken" class="section">
        <h2 class="section__title">LinkedIn Sync</h2>
        <div class="harvest-stats">
          <div class="harvest-stat">
            <strong>{{ linkedInSyncTotals.connections }}</strong>
            <span>Connections</span>
          </div>
          <div class="harvest-stat">
            <strong>{{ linkedInSyncTotals.invitations }}</strong>
            <span>Invites</span>
          </div>
          <div class="harvest-stat">
            <strong>{{ linkedInSyncTotals.threads }}</strong>
            <span>Threads</span>
          </div>
          <div class="harvest-stat">
            <strong>{{ linkedInSyncTotals.messages }}</strong>
            <span>Messages</span>
          </div>
        </div>
        <p class="hint">Sync every 30 mins</p>
        <p v-if="linkedInSafetySnapshot" class="hint">
          Safety: {{ linkedInSafetySnapshot.readRequestsLastHour }}/60 reads
          this hour · {{ linkedInSafetySnapshot.readRequestsToday }}/{{
            LINKEDIN_READ_REQUESTS_PER_DAY
          }}
          reads today · {{ linkedInSafetySnapshot.outboundAttemptsToday }}
          outbound attempts today.
        </p>
        <div class="safety-limit">
          <label
            class="safety-limit__label"
            for="linkedinDailyReadLimitEnabled"
          >
            Enforce daily read cap
          </label>
          <input
            id="linkedinDailyReadLimitEnabled"
            v-model="linkedInDailyReadLimitEnabled"
            type="checkbox"
            :disabled="isSavingLinkedInSafetySetting"
            @change="saveLinkedInDailyReadLimitEnabled"
          />
        </div>
        <p class="hint">
          <template v-if="linkedInDailyReadLimitEnabled">
            The 200-request daily read cap is on.
          </template>
          <template v-else>
            Testing mode: only the daily read cap is off. Hourly limits, request
            pacing, and restriction safeguards stay on.
          </template>
        </p>
        <button
          class="btn btn--primary sync-button"
          :disabled="isLinkedInSyncing"
          @click="syncLinkedInNow"
        >
          {{ isLinkedInSyncing ? 'Starting sync…' : 'Sync now' }}
        </button>
      </section>

      <!-- Recent Captures -->
      <section v-if="recentCaptures.length > 0" class="section">
        <h2 class="section__title">Recent Captures</h2>
        <ul class="captures-list">
          <li
            v-for="capture in recentCaptures"
            :key="capture.twentyId"
            class="capture-item"
            @click="openRecord(capture)"
          >
            <div class="capture-item__icon">
              <svg
                v-if="capture.type === 'person'"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <svg
                v-else
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"
                />
              </svg>
            </div>
            <div class="capture-item__info">
              <span class="capture-item__name">{{ capture.name }}</span>
              <span class="capture-item__time">{{
                formatDate(capture.capturedAt)
              }}</span>
            </div>
            <svg
              class="capture-item__arrow"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </li>
        </ul>
      </section>

      <!-- Instructions -->
      <section class="section section--muted">
        <h2 class="section__title">How to use</h2>
        <ol class="instructions">
          <li>Keep the local URLs above or adjust them</li>
          <li>Log in to local Twenty in this browser</li>
          <li>Visit any LinkedIn profile or company page</li>
          <li>Click the floating button to capture</li>
        </ol>
      </section>
    </main>
  </div>
</template>

<style scoped>
.popup {
  width: 360px;
  min-height: 400px;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #fafafa;
  color: #1f2937;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
}

.header__logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header__title {
  font-size: 16px;
  font-weight: 600;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.2);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.status--connected {
  color: #34d399;
}

.status--warning {
  color: #fbbf24;
}

.status--error {
  color: #f87171;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
  color: #6b7280;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #e5e7eb;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.content {
  padding: 16px 20px 20px;
}

.section {
  margin-bottom: 20px;
}

.section--warning {
  background: #fef3c7;
  padding: 16px;
  border-radius: 8px;
  margin: 0 -20px 20px;
  padding-left: 20px;
  padding-right: 20px;
}

.section--muted {
  opacity: 0.8;
}

.section__title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  margin-bottom: 12px;
}

.form-group {
  margin-bottom: 16px;
}

.label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: #374151;
}

.input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  box-sizing: border-box;
}

.input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.hint {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 4px;
}

.button-group {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
}

.btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.btn--secondary {
  background: #e5e7eb;
  color: #374151;
}

.btn--secondary:hover:not(:disabled) {
  background: #d1d5db;
}

.message {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.message--error {
  background: #fef2f2;
  color: #dc2626;
}

.message--success {
  background: #f0fdf4;
  color: #16a34a;
}

.warning-text {
  font-size: 14px;
  color: #92400e;
  margin-bottom: 12px;
}

.harvest-stats {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, 1fr);
}

.harvest-stat {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
}

.harvest-stat strong,
.harvest-stat span {
  display: block;
}

.sync-button {
  margin-top: 12px;
  width: 100%;
}

.safety-limit {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-top: 10px;
}

.safety-limit__label {
  color: #4b5563;
  font-size: 12px;
  font-weight: 500;
}

.harvest-stat strong {
  color: #111827;
  font-size: 18px;
  margin-bottom: 2px;
}

.harvest-stat span {
  color: #6b7280;
  font-size: 12px;
}

.captures-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.capture-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: white;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.capture-item:hover {
  background: #f3f4f6;
}

.capture-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #e5e7eb;
  border-radius: 50%;
  color: #6b7280;
}

.capture-item__info {
  flex: 1;
  min-width: 0;
}

.capture-item__name {
  display: block;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capture-item__time {
  font-size: 12px;
  color: #9ca3af;
}

.capture-item__arrow {
  color: #9ca3af;
}

.instructions {
  font-size: 13px;
  padding-left: 20px;
  margin: 0;
  color: #6b7280;
}

.instructions li {
  margin-bottom: 6px;
}

.instructions li:last-child {
  margin-bottom: 0;
}
</style>
