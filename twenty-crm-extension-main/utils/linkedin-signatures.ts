type LinkedInSignatureName =
  | 'threads'
  | 'thread-messages-pagination'
  | 'invitations'
  | 'received-invitations';

type LinkedInSignatureMatcher = {
  name: LinkedInSignatureName;
  idPrefix: string;
  exactNames: string[];
};

type LinkedInSignatures = Partial<Record<LinkedInSignatureName, string>>;

const LINKEDIN_SIGNATURE_CACHE_KEY = 'twentyLinkedinSignatureCache';
const MAX_SIGNATURE_SCRIPT_ASSETS = 300;
const SIGNATURE_SCRIPT_BATCH_SIZE = 12;
const LINKEDIN_TIMESTAMP_THREAD_SIGNATURE =
  'messengerConversations.8656fb361a8ad0c178e8d3ff1a84ce26';
const timestampThreadSignatures = new Set([
  LINKEDIN_TIMESTAMP_THREAD_SIGNATURE,
]);
const LINKEDIN_BUILT_IN_SIGNATURES: LinkedInSignatures = {
  threads: LINKEDIN_TIMESTAMP_THREAD_SIGNATURE,
  'thread-messages-pagination':
    'messengerMessages.4088d03bc70c91c3fa68965cb42336de',
};

export const usesLinkedInTimestampThreadPagination = (
  signature: string,
): boolean => timestampThreadSignatures.has(signature);
const LINKEDIN_SIGNATURE_DISCOVERY_PATHS = [
  '/feed',
  '/messaging/',
  '/mynetwork/invitation-manager/',
  '/mynetwork/invitation-manager/sent/',
];

performance.setResourceTimingBufferSize(5_000);

const SIGNATURE_MATCHERS: LinkedInSignatureMatcher[] = [
  {
    name: 'threads',
    idPrefix: 'messengerConversations.',
    exactNames: ['find-conversations-by-category-v2'],
  },
  {
    name: 'thread-messages-pagination',
    idPrefix: 'messengerMessages.',
    exactNames: ['get-messages-by-timestamp'],
  },
  {
    name: 'invitations',
    idPrefix: 'voyagerRelationshipsDashSentInvitationViews.',
    exactNames: ['sent-invitation-views-by-invitation-type'],
  },
  {
    name: 'received-invitations',
    idPrefix: 'voyagerRelationshipsDashInvitationViews.',
    exactNames: [
      'pending-invitations',
      'invitation-views-by-invitation-type',
      'received-invitation-views-by-invitation-type',
    ],
  },
  {
    name: 'received-invitations',
    idPrefix: 'voyagerRelationshipsDashReceivedInvitationViews.',
    exactNames: [
      'pending-invitations',
      'received-invitation-views-by-invitation-type',
    ],
  },
];

let sessionSignaturesPromise: Promise<LinkedInSignatures> | null = null;

const escapeRegularExpression = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isLinkedInScriptUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    return (
      url.pathname.endsWith('.js') &&
      (url.hostname === 'linkedin.com' ||
        url.hostname.endsWith('.linkedin.com') ||
        url.hostname === 'licdn.com' ||
        url.hostname.endsWith('.licdn.com'))
    );
  } catch {
    return false;
  }
};

const extractScriptUrls = (html: string, baseUrl: string): string[] => {
  const urls = new Set<string>();
  const pattern = /(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi;

  for (const match of html.matchAll(pattern)) {
    const source = match[1];

    if (source) {
      const url = new URL(source, baseUrl).toString();

      if (isLinkedInScriptUrl(url)) {
        urls.add(url);
      }
    }
  }

  return [...urls];
};

const extractImportedScriptUrls = (
  source: string,
  parentUrl: string,
): string[] => {
  const urls = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+\.js(?:\?[^"']*)?)["']/g,
    /\bimport\s*["']([^"']+\.js(?:\?[^"']*)?)["']/g,
    /\bimport\s*\(\s*["']([^"']+\.js(?:\?[^"']*)?)["']\s*\)/g,
    /["']([^"']+\.js(?:\?[^"']*)?)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const importedPath = match[1];

      if (!importedPath) {
        continue;
      }

      const url = new URL(importedPath, parentUrl).toString();

      if (isLinkedInScriptUrl(url)) {
        urls.add(url);
      }
    }
  }

  return [...urls];
};

const findSignature = (
  sources: string[],
  matcher: LinkedInSignatureMatcher,
): string | null => {
  const idPattern = new RegExp(
    `["']?id["']?\\s*:\\s*["'](${escapeRegularExpression(matcher.idPrefix)}[^"']*)["']`,
  );
  const namePattern = /["']?name["']?\s*:\s*["']([^"']*)["']/;
  const flatObjectPattern = /\{[^{}]{0,2000}\}/g;

  for (const source of sources) {
    for (const objectMatch of source.matchAll(flatObjectPattern)) {
      const id = objectMatch[0].match(idPattern)?.[1];
      const name = objectMatch[0].match(namePattern)?.[1];

      if (id && name && matcher.exactNames.includes(name)) {
        return id;
      }
    }
  }

  return null;
};

const getObservedSignatures = (): LinkedInSignatures => {
  const signatures: LinkedInSignatures = {};

  for (const entry of performance.getEntriesByType('resource')) {
    try {
      const url = new URL(entry.name);
      const queryId = url.searchParams.get('queryId');
      const variables = url.searchParams.get('variables') ?? '';

      if (!queryId) {
        continue;
      }

      if (
        queryId.startsWith('messengerConversations.') &&
        variables.includes('mailboxUrn:')
      ) {
        signatures.threads = queryId;

        if (variables.includes('lastUpdatedBefore:')) {
          timestampThreadSignatures.add(queryId);
        }
      }

      if (
        queryId.startsWith('messengerMessages.') &&
        variables.includes('deliveredAt:') &&
        variables.includes('conversationUrn:')
      ) {
        signatures['thread-messages-pagination'] = queryId;
      }

      for (const matcher of SIGNATURE_MATCHERS.filter(
        ({ name }) => name === 'invitations' || name === 'received-invitations',
      )) {
        if (queryId.startsWith(matcher.idPrefix)) {
          signatures[matcher.name] = queryId;
        }
      }
    } catch {
      // Resource Timing can contain non-URL browser entries.
    }
  }

  return signatures;
};

const readCachedSignatures = async (): Promise<LinkedInSignatures> => {
  const storedValue = await browser.storage.local.get(
    LINKEDIN_SIGNATURE_CACHE_KEY,
  );

  return (
    (storedValue[LINKEDIN_SIGNATURE_CACHE_KEY] as
      | LinkedInSignatures
      | undefined) ?? {}
  );
};

const fetchScriptSources = async (initialUrls: string[]): Promise<string[]> => {
  const pendingUrls = [...initialUrls];
  const visitedUrls = new Set<string>();
  const sources: string[] = [];

  while (
    pendingUrls.length > 0 &&
    visitedUrls.size < MAX_SIGNATURE_SCRIPT_ASSETS
  ) {
    const batch: string[] = [];

    while (
      pendingUrls.length > 0 &&
      batch.length < SIGNATURE_SCRIPT_BATCH_SIZE &&
      visitedUrls.size + batch.length < MAX_SIGNATURE_SCRIPT_ASSETS
    ) {
      const url = pendingUrls.shift();

      if (url && !visitedUrls.has(url) && !batch.includes(url)) {
        batch.push(url);
      }
    }

    if (batch.length === 0) {
      break;
    }

    batch.forEach((url) => visitedUrls.add(url));

    const fetchedSources = await Promise.all(
      batch.map(async (url) => {
        try {
          const response = await fetch(url, {
            credentials:
              new URL(url).origin === window.location.origin
                ? 'include'
                : 'omit',
          });

          if (!response.ok) {
            return null;
          }

          return { source: await response.text(), url };
        } catch {
          return null;
        }
      }),
    );

    for (const fetchedSource of fetchedSources) {
      if (!fetchedSource) {
        continue;
      }

      sources.push(fetchedSource.source);

      for (const importedUrl of extractImportedScriptUrls(
        fetchedSource.source,
        fetchedSource.url,
      )) {
        if (!visitedUrls.has(importedUrl)) {
          pendingUrls.push(importedUrl);
        }
      }
    }
  }

  return sources;
};

const scrapeSignatures = async (): Promise<LinkedInSignatures> => {
  const discoveryPages = (
    await Promise.all(
      LINKEDIN_SIGNATURE_DISCOVERY_PATHS.map(async (path) => {
        const url = new URL(path, window.location.origin).toString();

        try {
          const response = await fetch(url, { credentials: 'include' });

          return response.ok ? { html: await response.text(), url } : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((page): page is { html: string; url: string } => page !== null);

  if (discoveryPages.length === 0) {
    throw new Error('LinkedIn signature discovery could not load its pages');
  }

  const scriptUrls = [
    ...new Set(
      discoveryPages.flatMap(({ html, url }) => extractScriptUrls(html, url)),
    ),
  ];

  if (scriptUrls.length === 0) {
    throw new Error('LinkedIn signature discovery found no JavaScript assets');
  }

  const sources = [
    ...discoveryPages.map(({ html }) => html),
    ...(await fetchScriptSources(scriptUrls)),
  ];
  const signatures: LinkedInSignatures = {};

  for (const matcher of SIGNATURE_MATCHERS) {
    if (signatures[matcher.name]) {
      continue;
    }

    const signature = findSignature(sources, matcher);

    if (signature) {
      signatures[matcher.name] = signature;
    }
  }

  return signatures;
};

export const getLinkedInSignatures = (): Promise<LinkedInSignatures> => {
  if (!sessionSignaturesPromise) {
    sessionSignaturesPromise = (async () => {
      const cachedSignatures = await readCachedSignatures();
      const observedSignatures = getObservedSignatures();

      try {
        const scrapedSignatures = await scrapeSignatures();
        const signatures = {
          ...cachedSignatures,
          ...LINKEDIN_BUILT_IN_SIGNATURES,
          ...scrapedSignatures,
          ...observedSignatures,
        };

        if (
          Object.keys(scrapedSignatures).length > 0 ||
          Object.keys(observedSignatures).length > 0
        ) {
          await browser.storage.local.set({
            [LINKEDIN_SIGNATURE_CACHE_KEY]: signatures,
          });
        }

        return signatures;
      } catch (error) {
        console.warn('[Twenty] LinkedIn signature discovery failed:', error);
        return {
          ...cachedSignatures,
          ...LINKEDIN_BUILT_IN_SIGNATURES,
          ...observedSignatures,
        };
      }
    })();
  }

  return sessionSignaturesPromise;
};

export const getLinkedInSignature = async (
  name: LinkedInSignatureName,
): Promise<string | null> => {
  const signatures = await getLinkedInSignatures();
  const observedSignatures = getObservedSignatures();
  const observedSignature = observedSignatures[name];

  if (observedSignature && observedSignature !== signatures[name]) {
    Object.assign(signatures, observedSignatures);
    await browser.storage.local.set({
      [LINKEDIN_SIGNATURE_CACHE_KEY]: signatures,
    });
  }

  return signatures[name] ?? null;
};
