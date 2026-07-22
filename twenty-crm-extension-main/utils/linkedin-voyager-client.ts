import type { ExtensionResponse, LinkedInIdentity } from '../types';
import {
  getLinkedInSignature,
  usesLinkedInTimestampThreadPagination,
} from './linkedin-signatures';
import {
  reserveLinkedInReadRequest,
  tripLinkedInSafetyCircuit,
} from './linkedin-safety';
import { isLinkedInRestrictionUrl } from './linkedin-safety-policy';

const MAX_REQUESTS_PER_MINUTE = 8;
const REQUEST_WINDOW_MILLISECONDS = 60_000;
const MIN_REQUEST_DELAY_MILLISECONDS = 6_000;
const MAX_REQUEST_DELAY_MILLISECONDS = 12_000;

type VoyagerResponse = Record<string, unknown>;

type VoyagerPage = {
  response: VoyagerResponse;
  elements: unknown[];
  included: unknown[];
  hasMore: boolean;
  nextStart: number | null;
  nextCursor?: string | null;
  nextUpdatedBefore?: number | null;
  threadPaginationMode?: 'cursor' | 'timestamp';
};

type MessageThreadPagination = {
  cursor: string | null;
  updatedBefore: number;
};

type QueueEntry = {
  request: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

const getRecord = (
  value: unknown,
  key: string,
): Record<string, unknown> | null => asRecord(asRecord(value)?.[key]);

const getArray = (value: unknown, key: string): unknown[] => {
  const candidate = asRecord(value)?.[key];

  return Array.isArray(candidate) ? candidate : [];
};

const getString = (value: unknown, key: string): string | null => {
  const candidate = asRecord(value)?.[key];

  return typeof candidate === 'string' ? candidate : null;
};

const getIdentifier = (value: unknown, key: string): string | null => {
  const candidate = asRecord(value)?.[key];

  if (typeof candidate === 'string') {
    return candidate;
  }

  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate.toString()
    : null;
};

export const randomDelay = (
  minimumMilliseconds = 50,
  maximumMilliseconds = minimumMilliseconds,
): Promise<void> => {
  const duration =
    maximumMilliseconds > minimumMilliseconds
      ? Math.random() * (maximumMilliseconds - minimumMilliseconds) +
        minimumMilliseconds
      : minimumMilliseconds;

  return new Promise((resolve) => setTimeout(resolve, duration));
};

class LinkedInVoyagerClient {
  private csrfToken: string | null = null;
  private readonly requestQueue: QueueEntry[] = [];
  private readonly cursorUnsupportedThreadSignatures = new Set<string>();
  private requestTimestamps: number[] = [];
  private processingPromise: Promise<void> | null = null;
  private isFirstRequest = true;

  async initialize(): Promise<void> {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_LINKEDIN_CSRF_TOKEN',
    })) as ExtensionResponse<{ csrfToken: string }>;

    if (!response.success || !response.data?.csrfToken) {
      throw new Error(
        response.error ||
          'LinkedIn session cookie was not found. Sign in to LinkedIn first.',
      );
    }

    this.csrfToken = response.data.csrfToken;
  }

  private async processQueue(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      while (this.requestQueue.length > 0) {
        const now = Date.now();

        this.requestTimestamps = this.requestTimestamps.filter(
          (timestamp) => now - timestamp < REQUEST_WINDOW_MILLISECONDS,
        );

        if (this.requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
          const oldestTimestamp = this.requestTimestamps[0] ?? now;

          await randomDelay(
            Math.max(0, REQUEST_WINDOW_MILLISECONDS - (now - oldestTimestamp)),
          );
          continue;
        }

        const entry = this.requestQueue.shift();

        if (!entry) {
          continue;
        }

        try {
          entry.resolve(await entry.request());
        } catch (error) {
          entry.reject(error);
        } finally {
          this.requestTimestamps.push(Date.now());

          if (!this.isFirstRequest) {
            await randomDelay(
              MIN_REQUEST_DELAY_MILLISECONDS,
              MAX_REQUEST_DELAY_MILLISECONDS,
            );
          }

          this.isFirstRequest = false;
        }
      }
    })().finally(() => {
      this.processingPromise = null;
    });

    return this.processingPromise;
  }

  private queueRequest<TResponse>(
    request: () => Promise<TResponse>,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      this.requestQueue.push({
        request,
        resolve: (value) => resolve(value as TResponse),
        reject,
      });
      void this.processQueue();
    });
  }

  private buildRequestHeaders(
    pageToken?: string,
    isGraphql = false,
  ): Record<string, string> {
    if (!this.csrfToken) {
      throw new Error('LinkedIn Voyager client is not initialized');
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tracking = {
      clientVersion: '1.13.40953',
      mpVersion: '1.13.40953',
      osName: 'web',
      timezoneOffset: new Date().getTimezoneOffset() / 60,
      timezone,
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
      displayDensity: window.devicePixelRatio || 1,
      displayWidth: window.screen.width,
      displayHeight: window.screen.height,
    };

    return {
      accept: isGraphql
        ? 'application/graphql'
        : 'application/vnd.linkedin.normalized+json+2.1',
      'csrf-token': this.csrfToken,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'x-li-lang': 'en_US',
      'x-li-page-instance':
        pageToken ||
        'urn:li:page:d_flagship3_messaging_conversation_detail;W2/ZP9y3Tk2AyGubrb+6rw==',
      'x-li-track': JSON.stringify(tracking),
      'x-restli-protocol-version': '2.0.0',
    };
  }

  private request(
    path: string,
    options: { pageToken?: string; graphql?: boolean } = {},
  ): Promise<VoyagerResponse> {
    return this.queueRequest(async () => {
      await reserveLinkedInReadRequest();
      const response = await fetch(`https://www.linkedin.com${path}`, {
        method: 'GET',
        headers: this.buildRequestHeaders(
          options.pageToken,
          options.graphql ?? false,
        ),
        credentials: 'include',
        mode: 'cors',
        referrerPolicy: 'no-referrer-when-downgrade',
      });

      if (
        isLinkedInRestrictionUrl(response.url) ||
        [403, 429, 999].includes(response.status)
      ) {
        const reason =
          response.status === 429
            ? 'LinkedIn returned a rate-limit response. Automatic LinkedIn activity is paused for safety.'
            : 'LinkedIn returned a restriction or verification response. Automatic LinkedIn activity is paused for safety.';

        await tripLinkedInSafetyCircuit(reason);
        throw new Error(reason);
      }

      if (!response.ok) {
        throw new Error(
          `LinkedIn request failed (${response.status}). Sync stopped without retrying.`,
        );
      }

      const responseData = (await response.json()) as VoyagerResponse;
      const responsePreview = JSON.stringify(responseData).slice(0, 4_000);

      if (
        /FUSE_LIMIT_EXCEEDED|CHALLENGE_REQUIRED|ACCOUNT_RESTRICTED|TOO_MANY_REQUESTS/i.test(
          responsePreview,
        )
      ) {
        const reason =
          'LinkedIn returned a limit or verification signal. Automatic LinkedIn activity is paused for safety.';

        await tripLinkedInSafetyCircuit(reason);
        throw new Error(reason);
      }

      return responseData;
    });
  }

  getMe(): Promise<VoyagerResponse> {
    return this.request('/voyager/api/me');
  }

  async getIdentity(): Promise<LinkedInIdentity> {
    const response = await this.getMe();
    const data = getRecord(response, 'data');
    const miniProfileUrn = getString(data, '*miniProfile');
    const linkedinId = getIdentifier(data, 'plainId');
    const includedProfile = asRecord(getArray(response, 'included')[0]);

    if (!miniProfileUrn || !linkedinId) {
      throw new Error('LinkedIn did not return the signed-in member identity');
    }

    const firstName = getString(includedProfile, 'firstName') ?? '';
    const lastName = getString(includedProfile, 'lastName') ?? '';

    return {
      linkedinId,
      linkedinUrn: miniProfileUrn.replace('urn:li:fs_miniProfile:', ''),
      handle: getString(includedProfile, 'publicIdentifier'),
      name: `${firstName} ${lastName}`.trim() || linkedinId,
    };
  }

  async fetchConnectionsPage(start = 0, count = 500): Promise<VoyagerPage> {
    const query = new URLSearchParams({
      decorationId:
        'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16',
      count: count.toString(),
      q: 'search',
      sortType: 'RECENTLY_ADDED',
      start: start.toString(),
    });
    const response = await this.request(
      `/voyager/api/relationships/dash/connections?${query}`,
      {
        pageToken:
          'urn:li:page:d_flagship3_people_connections;t9aDIIkRQqW/5P7E51KceQ==',
      },
    );
    const data = getRecord(response, 'data');
    const elementReferences = getArray(data, '*elements');

    return {
      response,
      elements: elementReferences,
      included: getArray(response, 'included'),
      hasMore: elementReferences.length === count,
      nextStart: start + elementReferences.length,
    };
  }

  private async fetchInvitationRestPage(
    direction: 'SENT' | 'RECEIVED',
    start: number,
    count: number,
  ): Promise<VoyagerPage> {
    const query = new URLSearchParams({
      count: count.toString(),
      q: direction === 'SENT' ? 'invitationType' : 'receivedInvitation',
      start: start.toString(),
    });

    if (direction === 'SENT') {
      query.set('invitationType', 'CONNECTION');
    } else {
      query.set('includeInsights', 'true');
    }

    const resource =
      direction === 'SENT' ? 'sentInvitationViewsV2' : 'invitationViews';
    const response = await this.request(
      `/voyager/api/relationships/${resource}?${query}`,
      {
        pageToken:
          direction === 'SENT'
            ? 'urn:li:page:d_flagship3_people_invitations_sent;123ABC=='
            : 'urn:li:page:d_flagship3_people_invitations;123ABC==',
      },
    );
    const data = getRecord(response, 'data');
    const normalizedElements = getArray(data, '*elements');
    const elements =
      normalizedElements.length > 0
        ? normalizedElements
        : getArray(data, 'elements');

    return {
      response,
      elements,
      included: getArray(response, 'included'),
      hasMore: elements.length === count,
      nextStart: start + elements.length,
    };
  }

  async fetchSentInvitationsPage(start = 0, count = 100): Promise<VoyagerPage> {
    try {
      return await this.fetchInvitationRestPage('SENT', start, count);
    } catch (error) {
      console.warn(
        '[Twenty] LinkedIn sent-invitation REST request failed; trying GraphQL:',
        error,
      );
    }

    const signature = await getLinkedInSignature('invitations');

    if (!signature) {
      throw new Error(
        'LinkedIn invitation signature is unavailable. Reload LinkedIn after it finishes loading and try again.',
      );
    }

    const response = await this.request(
      `/voyager/api/graphql?variables=(start:${start},count:${count},invitationType:CONNECTION)&queryId=${encodeURIComponent(signature)}`,
      {
        pageToken: 'urn:li:page:d_flagship3_people_invitations_sent;123ABC==',
        graphql: true,
      },
    );
    const container = getRecord(
      getRecord(response, 'data'),
      'relationshipsDashSentInvitationViewsByInvitationType',
    );
    const elements = getArray(container, 'elements');

    return {
      response,
      elements,
      included: getArray(response, 'included'),
      hasMore: elements.length === count,
      nextStart: start + elements.length,
    };
  }

  async fetchReceivedInvitationsPage(
    start = 0,
    count = 100,
  ): Promise<VoyagerPage | null> {
    try {
      return await this.fetchInvitationRestPage('RECEIVED', start, count);
    } catch (error) {
      console.warn(
        '[Twenty] LinkedIn received-invitation REST request failed; trying GraphQL:',
        error,
      );
    }

    const signature = await getLinkedInSignature('received-invitations');

    if (!signature) {
      return null;
    }

    const response = await this.request(
      `/voyager/api/graphql?variables=(start:${start},count:${count},invitationType:CONNECTION)&queryId=${encodeURIComponent(signature)}`,
      {
        pageToken: 'urn:li:page:d_flagship3_people_invitations;123ABC==',
        graphql: true,
      },
    );
    const data = getRecord(response, 'data');
    const container =
      getRecord(
        data,
        'relationshipsDashReceivedInvitationViewsByInvitationType',
      ) ?? getRecord(data, 'relationshipsDashInvitationViewsByInvitationType');
    const elements = getArray(container, 'elements');

    return {
      response,
      elements,
      included: getArray(response, 'included'),
      hasMore: elements.length === count,
      nextStart: start + elements.length,
    };
  }

  async fetchMessageThreadsPage(
    linkedinUrn: string,
    pagination: MessageThreadPagination = {
      cursor: null,
      updatedBefore: Date.now(),
    },
    count = 25,
  ): Promise<VoyagerPage> {
    const signature = await getLinkedInSignature('threads');

    if (!signature) {
      throw new Error(
        'LinkedIn message-thread signature is unavailable. Reload LinkedIn after it finishes loading and try again.',
      );
    }

    const mailboxUrn = `urn:li:fsd_profile:${linkedinUrn}`;
    const signatureUsesTimestampPagination =
      usesLinkedInTimestampThreadPagination(signature);
    const loadPage = async (mode: 'cursor' | 'timestamp') => {
      const category = mode === 'timestamp' ? 'PRIMARY_INBOX' : 'INBOX';
      const predicate = `List((conversationCategoryPredicate:(category:${category})))`;
      const paginationVariable =
        mode === 'timestamp'
          ? `,lastUpdatedBefore:${Math.trunc(pagination.updatedBefore)}`
          : pagination.cursor
            ? `,nextCursor:${encodeURIComponent(pagination.cursor)}`
            : '';
      const path =
        `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${encodeURIComponent(signature)}` +
        `&variables=(query:(predicateUnions:${predicate}),count:${count},mailboxUrn:${encodeURIComponent(mailboxUrn)}${paginationVariable})`;
      const response = await this.request(path, { graphql: true });
      const container = getRecord(
        getRecord(response, 'data'),
        'messengerConversationsByCategoryQuery',
      );

      return { container, response };
    };
    let threadPaginationMode: 'cursor' | 'timestamp' =
      signatureUsesTimestampPagination &&
      (!pagination.cursor ||
        this.cursorUnsupportedThreadSignatures.has(signature))
        ? 'timestamp'
        : 'cursor';
    let pageResult: Awaited<ReturnType<typeof loadPage>>;

    try {
      pageResult = await loadPage(threadPaginationMode);
    } catch (error) {
      if (
        threadPaginationMode !== 'cursor' ||
        !signatureUsesTimestampPagination
      ) {
        throw error;
      }

      this.cursorUnsupportedThreadSignatures.add(signature);
      threadPaginationMode = 'timestamp';
      pageResult = await loadPage(threadPaginationMode);
    }

    if (
      threadPaginationMode === 'cursor' &&
      signatureUsesTimestampPagination &&
      (getArray(pageResult.container, 'elements').length === 0 ||
        !getString(getRecord(pageResult.container, 'metadata'), 'nextCursor'))
    ) {
      this.cursorUnsupportedThreadSignatures.add(signature);
      threadPaginationMode = 'timestamp';
      pageResult = await loadPage(threadPaginationMode);
    }

    const { container, response } = pageResult;
    const elements = getArray(container, 'elements');
    const metadata = getRecord(container, 'metadata');
    const nextCursor = getString(metadata, 'nextCursor');
    const activityTimes = elements
      .map((element) => asRecord(element)?.lastActivityAt)
      .filter(
        (lastActivityAt): lastActivityAt is number =>
          typeof lastActivityAt === 'number' && Number.isFinite(lastActivityAt),
      );
    const nextUpdatedBefore =
      activityTimes.length > 0 ? Math.min(...activityTimes) : null;

    return {
      response,
      elements,
      included: getArray(response, 'included'),
      hasMore:
        threadPaginationMode === 'timestamp'
          ? elements.length === count &&
            nextUpdatedBefore !== null &&
            nextUpdatedBefore < pagination.updatedBefore
          : Boolean(nextCursor),
      nextStart: null,
      nextCursor,
      nextUpdatedBefore,
      threadPaginationMode,
    };
  }

  async getThreadMessagesPagination(
    conversationUrn: string,
    deliveredAt: number,
    countBefore = 100,
    countAfter = 0,
  ): Promise<VoyagerPage> {
    const signature = await getLinkedInSignature('thread-messages-pagination');

    if (!signature) {
      throw new Error(
        'LinkedIn message signature is unavailable. Reload LinkedIn after it finishes loading and try again.',
      );
    }

    const encodedConversationUrn = encodeURIComponent(conversationUrn)
      .replaceAll('(', '%28')
      .replaceAll(')', '%29');
    const response = await this.request(
      `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${encodeURIComponent(signature)}&variables=(deliveredAt:${deliveredAt},conversationUrn:${encodedConversationUrn},countBefore:${countBefore},countAfter:${countAfter})`,
      {
        pageToken:
          'urn:li:page:d_flagship3_messaging_conversation_detail;sPGIvoQEQ8SiUSX2YtBMTQ==',
        graphql: true,
      },
    );
    const container = getRecord(
      getRecord(response, 'data'),
      'messengerMessagesByAnchorTimestamp',
    );
    const elements = getArray(container, 'elements');

    return {
      response,
      elements,
      included: getArray(response, 'included'),
      hasMore: elements.length === Math.max(countBefore, countAfter),
      nextStart: null,
    };
  }
}

export const linkedInVoyagerClient = new LinkedInVoyagerClient();
