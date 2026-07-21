import type { LinkedInConnectionState } from '../types';

const LINKEDIN_SELECTORS = {
  connectionDegree: [
    'main .dist-value',
    'main .distance-badge',
    'main [class*="distance-badge"]',
    'main [class*="distance"]',
  ],
  topCard: [
    'main .pv-top-card',
    'main [class*="top-card"]',
    'main section:first-of-type',
  ],
  dialog: ['div[role="dialog"]', '.artdeco-modal'],
  noteTextarea: [
    'textarea[name="message"]',
    'textarea#custom-message',
    'div[role="dialog"] textarea',
    '.artdeco-modal textarea',
  ],
  invitationRows: [
    'main li.invitation-card',
    'main .invitation-card',
    'main [data-view-name*="invitation"]',
    'main li',
  ],
} as const;

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isVisible = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0
  );
};

const normalizedText = (element: Element): string =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const findVisibleElement = <TElement extends Element>(
  selectors: readonly string[],
  root: ParentNode = document,
): TElement | null => {
  for (const selector of selectors) {
    const element = [...root.querySelectorAll<TElement>(selector)].find(
      isVisible,
    );

    if (element) {
      return element;
    }
  }

  return null;
};

const findClickableByText = (
  text: string,
  root: ParentNode = document,
): HTMLElement | null => {
  const expectedText = text.toLowerCase();
  const candidates = root.querySelectorAll<HTMLElement>(
    'button, a[role="button"], div[role="button"], [role="menuitem"]',
  );

  return (
    [...candidates].find(
      (candidate) =>
        isVisible(candidate) && normalizedText(candidate) === expectedText,
    ) ?? null
  );
};

const waitForElement = async <TElement extends Element>(
  findElement: () => TElement | null,
  timeoutMilliseconds = 4_000,
): Promise<TElement | null> => {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const element = findElement();

    if (element) {
      return element;
    }

    await wait(150);
  }

  return null;
};

export type LinkedInAutomationResult =
  | {
      status: 'COMPLETED' | 'SKIPPED';
      connectionState: LinkedInConnectionState;
    }
  | {
      status: 'FAILED';
      connectionState: LinkedInConnectionState;
      errorMessage: string;
    }
  | {
      status: 'NAVIGATING';
      connectionState: LinkedInConnectionState;
    };

export const detectConnectionDegree = ():
  | 'FIRST'
  | 'SECOND'
  | 'THIRD'
  | 'UNKNOWN' => {
  for (const selector of LINKEDIN_SELECTORS.connectionDegree) {
    for (const element of document.querySelectorAll(selector)) {
      if (!isVisible(element)) {
        continue;
      }

      const text = normalizedText(element);

      if (/\b1st\b/.test(text)) return 'FIRST';
      if (/\b2nd\b/.test(text)) return 'SECOND';
      if (/\b3rd\+?\b/.test(text)) return 'THIRD';
    }
  }

  return 'UNKNOWN';
};

const detectPendingInvitation = (): boolean => {
  const topCard = findVisibleElement<HTMLElement>(LINKEDIN_SELECTORS.topCard);

  return Boolean(findClickableByText('Pending', topCard ?? document));
};

const setTextareaValue = (
  textarea: HTMLTextAreaElement,
  value: string,
): void => {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;

  valueSetter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
};

export const sendConnectionRequest = async (
  noteText: string,
): Promise<LinkedInAutomationResult> => {
  if (detectConnectionDegree() === 'FIRST') {
    return { status: 'SKIPPED', connectionState: 'CONNECTED' };
  }

  if (detectPendingInvitation()) {
    return { status: 'SKIPPED', connectionState: 'PENDING' };
  }

  const topCard = findVisibleElement<HTMLElement>(LINKEDIN_SELECTORS.topCard);

  if (!topCard) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: 'Could not recognize the LinkedIn profile top card',
    };
  }

  let connectButton = findClickableByText('Connect', topCard);

  if (!connectButton) {
    const moreButton = findClickableByText('More', topCard);

    if (!moreButton) {
      return {
        status: 'FAILED',
        connectionState: 'UNKNOWN',
        errorMessage: 'Could not find a recognized Connect or More control',
      };
    }

    moreButton.click();
    connectButton = await waitForElement(() => {
      const menu = document.querySelector<HTMLElement>('[role="menu"]');

      return menu ? findClickableByText('Connect', menu) : null;
    });
  }

  if (!connectButton) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: 'Connect was not available in the profile actions menu',
    };
  }

  connectButton.click();
  const dialog = await waitForElement(() =>
    findVisibleElement<HTMLElement>(LINKEDIN_SELECTORS.dialog),
  );

  if (!dialog) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: 'LinkedIn did not open a recognized invitation dialog',
    };
  }

  if (noteText.length > 0) {
    const addNoteButton = findClickableByText('Add a note', dialog);

    if (!addNoteButton) {
      return {
        status: 'FAILED',
        connectionState: 'NOT_CONNECTED',
        errorMessage: 'The invitation dialog did not contain Add a note',
      };
    }

    addNoteButton.click();
    const textarea = await waitForElement(() =>
      findVisibleElement<HTMLTextAreaElement>(
        LINKEDIN_SELECTORS.noteTextarea,
        dialog,
      ),
    );

    if (!textarea) {
      return {
        status: 'FAILED',
        connectionState: 'NOT_CONNECTED',
        errorMessage: 'The invitation note textarea was not recognized',
      };
    }

    setTextareaValue(textarea, noteText);
    const sendButton = findClickableByText('Send', dialog);

    if (!sendButton) {
      return {
        status: 'FAILED',
        connectionState: 'NOT_CONNECTED',
        errorMessage: 'The invitation dialog did not contain Send',
      };
    }

    sendButton.click();
  } else {
    const sendButton =
      findClickableByText('Send without a note', dialog) ??
      findClickableByText('Send', dialog);

    if (!sendButton) {
      return {
        status: 'FAILED',
        connectionState: 'NOT_CONNECTED',
        errorMessage:
          'The invitation dialog did not contain a recognized send control',
      };
    }

    sendButton.click();
  }

  return { status: 'COMPLETED', connectionState: 'PENDING' };
};

const getProfileHandle = (profileUrl: string): string | null => {
  try {
    const url = new URL(profileUrl);
    const match = url.pathname.match(/^\/in\/([^/]+)/);

    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
};

export const withdrawConnectionRequest = async (
  profileUrl: string,
): Promise<LinkedInAutomationResult> => {
  const invitationManagerPath = '/mynetwork/invitation-manager/sent/';

  if (!window.location.pathname.startsWith(invitationManagerPath)) {
    window.location.assign(`${window.location.origin}${invitationManagerPath}`);

    return { status: 'NAVIGATING', connectionState: 'UNKNOWN' };
  }

  const profileHandle = getProfileHandle(profileUrl);

  if (!profileHandle) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: 'The LinkedIn profile URL did not contain a profile handle',
    };
  }

  const matchingRow = [
    ...document.querySelectorAll<HTMLElement>(
      LINKEDIN_SELECTORS.invitationRows.join(','),
    ),
  ].find((row) =>
    [...row.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')].some(
      (link) => getProfileHandle(link.href) === profileHandle,
    ),
  );

  if (!matchingRow) {
    return { status: 'SKIPPED', connectionState: 'CONNECTED' };
  }

  const withdrawButton = findClickableByText('Withdraw', matchingRow);

  if (!withdrawButton) {
    return {
      status: 'FAILED',
      connectionState: 'PENDING',
      errorMessage: 'The matching invitation did not contain Withdraw',
    };
  }

  withdrawButton.click();
  const dialog = await waitForElement(() =>
    findVisibleElement<HTMLElement>(LINKEDIN_SELECTORS.dialog),
  );
  const confirmButton = dialog ? findClickableByText('Withdraw', dialog) : null;

  if (!confirmButton) {
    return {
      status: 'FAILED',
      connectionState: 'PENDING',
      errorMessage:
        'LinkedIn did not show a recognized withdrawal confirmation',
    };
  }

  confirmButton.click();

  return { status: 'COMPLETED', connectionState: 'WITHDRAWN' };
};
