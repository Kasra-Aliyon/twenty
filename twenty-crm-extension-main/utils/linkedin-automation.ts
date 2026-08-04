import type { LinkedInConnectionState } from '../types';
import { isLinkedInRestrictionUrl } from './linkedin-safety-policy';

const LINKEDIN_CONNECTION_NOTE_MAX_LENGTH = 200;
const LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH = 2_000;

const SEND_CONFIRMATION_TIMEOUT_MILLISECONDS = 8_000;

const LINKEDIN_SELECTORS = {
  // Degree badges carry the degree on their own, so they are matched by exact
  // token rather than by scanning a section for "1st" anywhere in its text.
  degreeBadge: [
    '.dist-value',
    '.distance-badge .dist-value',
    '[class*="distance-badge"]',
    '[class*="__degree"]',
  ],
  dialog: ['div[role="dialog"]', '.artdeco-modal'],
  noteTextarea: [
    'textarea[name="message"]',
    'textarea#custom-message',
    'div[role="dialog"] textarea',
    '.artdeco-modal textarea',
  ],
  messageComposer: [
    '.msg-form',
    '.msg-overlay-conversation-bubble',
    'div[role="dialog"]',
  ],
  messageInput: [
    '.msg-form__contenteditable[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[name="message"]',
    'textarea',
  ],
  invitationRows: [
    'main li.invitation-card',
    'main .invitation-card',
    'main [data-view-name*="invitation"]',
    'main li',
  ],
} as const;

// Recommendation rails ("More profiles for you", "People also viewed") render
// their own degree badges and Connect buttons inside main. Everything the
// profile-level automation reads must exclude them, otherwise another person's
// 1st-degree badge is read as the viewed profile's own state.
const ENTITY_CARD_SELECTOR =
  'li, aside, [data-view-name*="entity"], [class*="entity-lockup"], [class*="discover-entity"], [class*="browsemap"], [class*="pymk"]';

type ConnectionDegree = 'FIRST' | 'SECOND' | 'THIRD' | 'UNKNOWN';

type ProfileActionControls = {
  connect: HTMLElement | null;
  pending: HTMLElement | null;
  message: HTMLElement | null;
  more: HTMLElement | null;
};

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

const accessibleLabel = (element: Element): string =>
  (element.getAttribute('aria-label') ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const isProfileLevelElement = (element: Element): boolean =>
  !element.closest(ENTITY_CARD_SELECTOR);

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

const clickableCandidates = (root: ParentNode = document): HTMLElement[] =>
  [
    ...root.querySelectorAll<HTMLElement>(
      'button, a[role="button"], div[role="button"], [role="menuitem"]',
    ),
  ].filter(isVisible);

// LinkedIn labels the same control differently across surfaces and locales
// ("Connect", "Invite Jane Doe to connect", "Send without note"). Matching only
// on exact text made every one of these controls invisible to the runner, so
// each control is described by the patterns it can present instead.
const matchesControl = (
  element: HTMLElement,
  { text, label }: { text: readonly string[]; label: readonly RegExp[] },
): boolean => {
  const elementLabel = accessibleLabel(element);

  if (label.some((pattern) => pattern.test(elementLabel))) {
    return true;
  }

  const elementText = normalizedText(element);

  return text.some(
    (candidate) => elementText === candidate || elementLabel === candidate,
  );
};

const CONTROL_PATTERNS = {
  connect: {
    text: ['connect'],
    label: [/^invite\b.*\bto connect$/, /^connect\b/],
  },
  pending: {
    text: ['pending'],
    label: [/^pending\b/, /\bwithdraw invitation\b/],
  },
  message: { text: ['message'], label: [/^message\b/] },
  more: {
    text: ['more', 'more actions'],
    label: [/^more actions/, /^more\b/],
  },
  addNote: {
    text: ['add a note', 'add note', 'add a free note'],
    label: [/^add a? ?(free )?note$/],
  },
  send: {
    text: ['send', 'send invitation', 'send now', 'send invite'],
    label: [/^send( invitation| invite| now)?$/],
  },
  sendWithoutNote: {
    text: ['send without a note', 'send without note'],
    label: [/^send without a? ?note$/],
  },
  withdraw: { text: ['withdraw'], label: [/^withdraw\b/] },
} as const;

const findControl = (
  control: keyof typeof CONTROL_PATTERNS,
  root: ParentNode = document,
  { profileLevelOnly = false }: { profileLevelOnly?: boolean } = {},
): HTMLElement | null =>
  clickableCandidates(root).find(
    (candidate) =>
      matchesControl(candidate, CONTROL_PATTERNS[control]) &&
      (!profileLevelOnly || isProfileLevelElement(candidate)),
  ) ?? null;

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

const parseDegreeToken = (value: string): ConnectionDegree => {
  // The badge must be exactly a degree token. Substring matching against a
  // whole section is what previously reported unrelated people as 1st-degree.
  if (/^1(st|er|re|°)?$/.test(value)) return 'FIRST';
  if (/^2(nd|e|°)?$/.test(value)) return 'SECOND';
  if (/^3(rd|e|°)?\+?$/.test(value)) return 'THIRD';

  return 'UNKNOWN';
};

export const detectConnectionDegree = (): ConnectionDegree => {
  const main = document.querySelector('main') ?? document;

  for (const selector of LINKEDIN_SELECTORS.degreeBadge) {
    for (const element of main.querySelectorAll(selector)) {
      if (!isVisible(element) || !isProfileLevelElement(element)) {
        continue;
      }

      // Badges often read "· 2nd degree connection"; keep only the token.
      const token = normalizedText(element)
        .replace(/degree|connection|·|·|,/g, ' ')
        .trim()
        .split(' ')[0];
      const degree = parseDegreeToken(token);

      if (degree !== 'UNKNOWN') {
        return degree;
      }
    }
  }

  return 'UNKNOWN';
};

const getProfileActionControls = (): ProfileActionControls => ({
  connect: findControl('connect', document, { profileLevelOnly: true }),
  pending: findControl('pending', document, { profileLevelOnly: true }),
  message: findControl('message', document, { profileLevelOnly: true }),
  more: findControl('more', document, { profileLevelOnly: true }),
});

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

const setContentEditableValue = (element: HTMLElement, value: string): void => {
  element.focus();
  element.replaceChildren(document.createTextNode(value));
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      data: value,
      inputType: 'insertText',
    }),
  );
};

export const getLinkedInAutomationBlockReason = (): string | null => {
  if (isLinkedInRestrictionUrl(window.location.href)) {
    return 'LinkedIn opened a verification or restriction page.';
  }

  const visibleText = (document.body?.innerText ?? '').toLowerCase();
  const restrictionSignals = [
    'unusual activity',
    'temporarily restricted',
    'your account has been restricted',
    'verify your identity',
    'security verification',
    'commercial use limit',
    'weekly invitation limit',
    "you've reached the weekly invitation limit",
    'try again later',
  ];
  const signal = restrictionSignals.find((candidate) =>
    visibleText.includes(candidate),
  );

  return signal
    ? `LinkedIn displayed a safety or limit warning (${signal}).`
    : null;
};

// A send is only reported as completed once LinkedIn confirms it: the
// invitation dialog closes and the profile stops offering Connect. Returning
// COMPLETED after a fixed sleep reported successes that never left the browser.
const confirmInvitationSent = async (
  dialog: HTMLElement,
): Promise<{ confirmed: boolean; reason: string | null }> => {
  const deadline = Date.now() + SEND_CONFIRMATION_TIMEOUT_MILLISECONDS;

  while (Date.now() < deadline) {
    const blockReason = getLinkedInAutomationBlockReason();

    if (blockReason) {
      return { confirmed: false, reason: blockReason };
    }

    const isDialogClosed = !dialog.isConnected || !isVisible(dialog);

    if (isDialogClosed) {
      const controls = getProfileActionControls();

      if (controls.pending || !controls.connect) {
        return { confirmed: true, reason: null };
      }

      // The dialog closed but Connect is still offered, which is how LinkedIn
      // presents a dismissed or rejected invitation.
      return {
        confirmed: false,
        reason:
          'LinkedIn closed the invitation dialog without sending the request',
      };
    }

    await wait(250);
  }

  return {
    confirmed: false,
    reason: 'LinkedIn did not confirm that the invitation was sent',
  };
};

export const sendConnectionRequest = async (
  noteText: string,
  skipIfAlreadyConnected = true,
): Promise<LinkedInAutomationResult> => {
  const blockReason = getLinkedInAutomationBlockReason();

  if (blockReason) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: blockReason,
    };
  }

  if (noteText.length > LINKEDIN_CONNECTION_NOTE_MAX_LENGTH) {
    return {
      status: 'FAILED',
      connectionState: 'NOT_CONNECTED',
      errorMessage: `Connection notes must be ${LINKEDIN_CONNECTION_NOTE_MAX_LENGTH} characters or fewer`,
    };
  }

  const controls = getProfileActionControls();
  const degree = detectConnectionDegree();

  // Skipping happens only on positive evidence. An unreadable page is reported
  // as a failure so the enrollment surfaces the problem instead of silently
  // recording a connection that was never requested.
  if (controls.pending) {
    return { status: 'SKIPPED', connectionState: 'PENDING' };
  }

  if (skipIfAlreadyConnected && degree === 'FIRST') {
    return { status: 'SKIPPED', connectionState: 'CONNECTED' };
  }

  let connectButton = controls.connect;

  if (!connectButton) {
    const moreButton = controls.more;

    if (!moreButton) {
      return {
        status: 'FAILED',
        connectionState: degree === 'FIRST' ? 'CONNECTED' : 'UNKNOWN',
        errorMessage:
          degree === 'FIRST'
            ? 'LinkedIn shows this profile as an existing connection and offered no Connect control'
            : 'Could not find a recognized Connect or More control on the profile',
      };
    }

    moreButton.click();
    connectButton = await waitForElement(() => {
      const menu = document.querySelector<HTMLElement>('[role="menu"]');

      return menu ? findControl('connect', menu) : null;
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
    // Some invitation dialogs expose the note field directly, so a missing
    // "Add a note" button is only a failure when no textarea appears either.
    const addNoteButton = findControl('addNote', dialog);

    addNoteButton?.click();

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
        errorMessage: 'The invitation note field was not recognized',
      };
    }

    setTextareaValue(textarea, noteText);
    await wait(300);

    const sendButton = findControl('send', dialog);

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
      findControl('sendWithoutNote', dialog) ?? findControl('send', dialog);

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

  const { confirmed, reason } = await confirmInvitationSent(dialog);

  if (!confirmed) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: reason ?? 'The invitation could not be confirmed as sent',
    };
  }

  return { status: 'COMPLETED', connectionState: 'PENDING' };
};

export const sendDirectMessage = async (
  rawMessageText: string,
): Promise<LinkedInAutomationResult> => {
  const blockReason = getLinkedInAutomationBlockReason();

  if (blockReason) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: blockReason,
    };
  }

  const messageText = rawMessageText.trim();

  if (messageText.length === 0) {
    return {
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: 'LinkedIn messages cannot be empty',
    };
  }

  if (messageText.length > LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH) {
    return {
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: 'LinkedIn messages must be 2000 characters or fewer',
    };
  }

  const controls = getProfileActionControls();
  const connectionDegree = detectConnectionDegree();

  // A pending invitation is a legitimate waiting state rather than an error, so
  // it is reported as such and the recorded connection state stays accurate.
  if (controls.pending) {
    return {
      status: 'FAILED',
      connectionState: 'PENDING',
      errorMessage:
        'The connection request is still pending, so a direct message cannot be sent yet',
    };
  }

  if (connectionDegree !== 'FIRST') {
    return {
      status: 'FAILED',
      connectionState:
        connectionDegree === 'UNKNOWN' ? 'UNKNOWN' : 'NOT_CONNECTED',
      errorMessage:
        'Direct messages are limited to recognized first-degree connections',
    };
  }

  const messageButton = controls.message;

  if (!messageButton) {
    return {
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: 'Could not find the profile Message control',
    };
  }

  messageButton.click();
  const composer = await waitForElement(() =>
    findVisibleElement<HTMLElement>(LINKEDIN_SELECTORS.messageComposer),
  );

  if (!composer) {
    return {
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: 'LinkedIn did not open a recognized message composer',
    };
  }

  const input = await waitForElement(() =>
    findVisibleElement<HTMLElement>(LINKEDIN_SELECTORS.messageInput, composer),
  );

  if (!input) {
    return {
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: 'The LinkedIn message field was not recognized',
    };
  }

  if (input instanceof HTMLTextAreaElement) {
    setTextareaValue(input, messageText);
  } else {
    setContentEditableValue(input, messageText);
  }

  await wait(300);
  const sendButton =
    [
      ...composer.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    ].find((button) => isVisible(button) && !button.disabled) ??
    findControl('send', composer);

  if (!sendButton || sendButton.getAttribute('aria-disabled') === 'true') {
    return {
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: 'The LinkedIn message composer was not ready to send',
    };
  }

  sendButton.click();
  await wait(1_500);
  const postSendBlockReason = getLinkedInAutomationBlockReason();

  if (postSendBlockReason) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: postSendBlockReason,
    };
  }

  return { status: 'COMPLETED', connectionState: 'CONNECTED' };
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

export const isInvitationManagerPath = (pathname: string): boolean =>
  /^\/mynetwork\/(invitation-manager|invite-connect\/invitations)\b/.test(
    pathname,
  );

export const withdrawConnectionRequest = async (
  profileUrl: string,
): Promise<LinkedInAutomationResult> => {
  const blockReason = getLinkedInAutomationBlockReason();

  if (blockReason) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: blockReason,
    };
  }

  // LinkedIn redirects between several invitation-manager paths, so the check
  // accepts any of them instead of looping on a single exact prefix.
  if (!isInvitationManagerPath(window.location.pathname)) {
    window.location.assign(
      `${window.location.origin}/mynetwork/invitation-manager/sent/`,
    );

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

  // An absent row means the invitation is no longer outstanding. It may have
  // been accepted, withdrawn, or expired, and the page cannot tell them apart,
  // so the connection state is left unknown rather than asserted as connected.
  if (!matchingRow) {
    return { status: 'SKIPPED', connectionState: 'UNKNOWN' };
  }

  const withdrawButton = findControl('withdraw', matchingRow);

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
  const confirmButton = dialog ? findControl('withdraw', dialog) : null;

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
