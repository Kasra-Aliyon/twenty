import type { LinkedInConnectionState } from '../types';
import { isLinkedInRestrictionUrl } from './linkedin-safety-policy';

const LINKEDIN_CONNECTION_NOTE_MAX_LENGTH = 200;
const LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH = 2_000;

const SEND_CONFIRMATION_TIMEOUT_MILLISECONDS = 8_000;
const LINKEDIN_INVITATION_AUTOMATION_REVISION = '2026-08-07.2';
const INVITATION_DIALOG_TITLE_PATTERN = /add a note to (?:your )?invitation/i;
const RELATIONSHIP_PROMPT_TITLE_PATTERN = /how do you know\b/i;
const RELATIONSHIP_MESSAGE_FIRST_PATTERN =
  /(?:send|write) (?:them|this member|the member) a message first|message (?:them|this member) first/i;

const LINKEDIN_SELECTORS = {
  // Degree badges carry the degree on their own, so they are matched by exact
  // token rather than by scanning a section for "1st" anywhere in its text.
  degreeBadge: [
    '.dist-value',
    '.distance-badge .dist-value',
    '[class*="distance-badge"]',
    '[class*="__degree"]',
  ],
  dialog: [
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '.artdeco-modal',
    '[aria-modal="true"]',
  ],
  menu: [
    '[role="menu"]',
    '.artdeco-dropdown__content',
    '.artdeco-dropdown__content-inner',
    '[data-view-name*="overflow"]',
  ],
  confirmation: [
    '[role="alert"]',
    '[role="status"]',
    '.artdeco-toast-item',
    '[data-view-name*="toast"]',
  ],
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
  const elementWindow = element.ownerDocument.defaultView;

  if (!elementWindow || typeof element.getBoundingClientRect !== 'function') {
    return false;
  }

  const style = elementWindow.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0
  );
};

// LinkedIn mounts invitation UI in several different places: the profile
// document, a /preload/ frame, and open shadow roots owned by those surfaces.
// The frame host itself can report a zero-sized box even while its sheet is
// rendered, so only candidate controls are visibility-filtered.
const getAccessibleLinkedInRoots = (
  initialRoot: ParentNode = document,
): ParentNode[] => {
  const accessibleRoots: ParentNode[] = [];
  const visitedRoots = new Set<ParentNode>();

  const visitRoot = (currentRoot: ParentNode) => {
    if (visitedRoots.has(currentRoot)) {
      return;
    }

    visitedRoots.add(currentRoot);
    accessibleRoots.push(currentRoot);

    const rootElement =
      currentRoot.nodeType === 1 ? (currentRoot as Element) : null;
    const elements = [
      ...(rootElement ? [rootElement] : []),
      ...currentRoot.querySelectorAll<Element>('*'),
    ];

    for (const element of elements) {
      if (element.shadowRoot) {
        visitRoot(element.shadowRoot);
      }

      if (element.localName !== 'iframe') {
        continue;
      }

      try {
        const frameDocument = (element as HTMLIFrameElement).contentDocument;

        if (frameDocument) {
          visitRoot(frameDocument);
        }
      } catch {
        // Cross-origin frames are intentionally ignored. The LinkedIn preload
        // surface is same-origin and remains accessible here.
      }
    }
  };

  visitRoot(initialRoot);

  return accessibleRoots;
};

const getAccessibleLinkedInDocuments = (): Document[] =>
  getAccessibleLinkedInRoots().filter(
    (root): root is Document => root.nodeType === 9,
  );

const querySelectorAllAcrossRoots = <TElement extends Element>(
  selector: string,
  root: ParentNode = document,
): TElement[] => {
  const elements = new Set<TElement>();

  for (const accessibleRoot of getAccessibleLinkedInRoots(root)) {
    for (const element of accessibleRoot.querySelectorAll<TElement>(selector)) {
      elements.add(element);
    }
  }

  return [...elements];
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
    const element = querySelectorAllAcrossRoots<TElement>(selector, root).find(
      isVisible,
    );

    if (element) {
      return element;
    }
  }

  return null;
};

const clickableCandidates = (root: ParentNode = document): HTMLElement[] =>
  querySelectorAllAcrossRoots<HTMLElement>(
    'button, a[role="button"], a[href*="/preload/custom-invite"], div[role="button"], [role="menuitem"]',
    root,
  ).filter(isVisible);

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
    label: [/^add a? ?(free )?note\b/],
  },
  send: {
    text: ['send', 'send invitation', 'send now', 'send invite'],
    label: [/^send( invitation| invite| now)?$/],
  },
  sendWithoutNote: {
    text: ['send without a note', 'send without note'],
    label: [/^send without a? ?note\b/],
  },
  withdraw: { text: ['withdraw'], label: [/^withdraw\b/] },
} as const;

const findControls = (
  control: keyof typeof CONTROL_PATTERNS,
  root: ParentNode = document,
  { profileLevelOnly = false }: { profileLevelOnly?: boolean } = {},
): HTMLElement[] =>
  clickableCandidates(root).filter(
    (candidate) =>
      matchesControl(candidate, CONTROL_PATTERNS[control]) &&
      (!profileLevelOnly || isProfileLevelElement(candidate)),
  );

const findControl = (
  control: keyof typeof CONTROL_PATTERNS,
  root: ParentNode = document,
  options: { profileLevelOnly?: boolean } = {},
): HTMLElement | null => findControls(control, root, options)[0] ?? null;

const isEnabledControl = (control: HTMLElement): boolean =>
  (control as HTMLButtonElement).disabled !== true &&
  !control.hasAttribute('disabled') &&
  control.getAttribute('aria-disabled') !== 'true';

const findControlInOpenMenu = (
  control: 'connect' | 'pending',
  controlsPresentBeforeOpening: ReadonlySet<HTMLElement> = new Set(),
): HTMLElement | null => {
  for (const selector of LINKEDIN_SELECTORS.menu) {
    for (const menu of querySelectorAllAcrossRoots<HTMLElement>(selector)) {
      if (!isVisible(menu)) {
        continue;
      }

      const menuControl = findControl(control, menu);

      if (menuControl) {
        return menuControl;
      }
    }
  }

  // LinkedIn has shipped overflow menus without menu roles or its legacy
  // artdeco classes. In that variant, the newly rendered control is still
  // distinguishable from recommendation-rail controls that existed before
  // More was opened.
  return (
    findControls(control).find(
      (candidate) =>
        candidate.matches('[role="menuitem"]') ||
        !controlsPresentBeforeOpening.has(candidate),
    ) ?? null
  );
};

const isInvitationDialog = (element: HTMLElement): boolean =>
  Boolean(
    findControl('sendWithoutNote', element) ||
    findControl('addNote', element) ||
    findVisibleElement<HTMLTextAreaElement>(
      LINKEDIN_SELECTORS.noteTextarea,
      element,
    ),
  );

const findInvitationDialog = (): HTMLElement | null => {
  const accessibleRoots = getAccessibleLinkedInRoots();

  for (const currentRoot of accessibleRoots) {
    for (const selector of LINKEDIN_SELECTORS.dialog) {
      for (const element of currentRoot.querySelectorAll<HTMLElement>(
        selector,
      )) {
        if (isVisible(element) && isInvitationDialog(element)) {
          return element;
        }
      }
    }
  }

  // The current LinkedIn connection sheet is not consistently exposed as a
  // native/ARIA dialog. Anchor on its unique action and walk to the smallest
  // stable ancestor carrying the invitation title instead of depending on a
  // generated class name.
  for (const currentRoot of accessibleRoots) {
    const sendWithoutNote = findControl('sendWithoutNote', currentRoot);

    if (!sendWithoutNote) {
      continue;
    }

    let fallbackContainer: HTMLElement | null = null;
    let ancestor = sendWithoutNote.parentElement;

    while (ancestor) {
      if (isVisible(ancestor)) {
        if (INVITATION_DIALOG_TITLE_PATTERN.test(normalizedText(ancestor))) {
          return ancestor;
        }

        if (
          !fallbackContainer &&
          findControl('addNote', ancestor) &&
          findControl('sendWithoutNote', ancestor)
        ) {
          fallbackContainer = ancestor;
        }
      }

      ancestor = ancestor.parentElement;
    }

    if (fallbackContainer) {
      return fallbackContainer;
    }
  }

  return null;
};

const findRelationshipPrompt = (): HTMLElement | null => {
  const accessibleRoots = getAccessibleLinkedInRoots();

  for (const currentRoot of accessibleRoots) {
    for (const selector of LINKEDIN_SELECTORS.dialog) {
      for (const element of currentRoot.querySelectorAll<HTMLElement>(
        selector,
      )) {
        if (
          isVisible(element) &&
          RELATIONSHIP_PROMPT_TITLE_PATTERN.test(normalizedText(element))
        ) {
          return element;
        }
      }
    }
  }

  for (const currentRoot of accessibleRoots) {
    const heading = [
      ...currentRoot.querySelectorAll<HTMLElement>(
        'h1, h2, h3, [role="heading"]',
      ),
    ].find(
      (element) =>
        isVisible(element) &&
        RELATIONSHIP_PROMPT_TITLE_PATTERN.test(normalizedText(element)),
    );

    if (!heading) {
      continue;
    }

    let ancestor = heading.parentElement;

    while (ancestor) {
      if (
        isVisible(ancestor) &&
        querySelectorAllAcrossRoots('button, [role="radio"], label', ancestor)
          .length > 0
      ) {
        return ancestor;
      }

      ancestor = ancestor.parentElement;
    }
  }

  return null;
};

const findTruthfulRelationshipOption = (
  prompt: HTMLElement,
): HTMLElement | null => {
  const optionPatterns = [
    /^other$/i,
    /^we don['’]t know each other$/i,
    /^i don['’]t know (?:this person|them)$/i,
  ];

  return (
    querySelectorAllAcrossRoots<HTMLElement>(
      'button, [role="radio"], label, input[type="radio"]',
      prompt,
    ).find((candidate) => {
      if (!isVisible(candidate)) {
        return false;
      }

      const candidateText = normalizedText(candidate);
      const candidateLabel = accessibleLabel(candidate);

      return optionPatterns.some(
        (pattern) =>
          pattern.test(candidateText) || pattern.test(candidateLabel),
      );
    }) ?? null
  );
};

const findRelationshipAdvanceControl = (
  prompt: HTMLElement,
): HTMLElement | null =>
  clickableCandidates(prompt).find((candidate) => {
    if (!isEnabledControl(candidate)) {
      return false;
    }

    const text = normalizedText(candidate);
    const label = accessibleLabel(candidate);

    return (
      /^(?:continue|next|connect)$/.test(text) ||
      /^(?:continue|next|connect)\b/.test(label)
    );
  }) ?? null;

const summarizeVisibleConnectionSurface = (): string => {
  const accessibleRoots = getAccessibleLinkedInRoots();
  const surfaces = accessibleRoots.flatMap((currentRoot) =>
    LINKEDIN_SELECTORS.dialog
      .flatMap((selector) => [
        ...currentRoot.querySelectorAll<HTMLElement>(selector),
      ])
      .filter(isVisible),
  );
  const surface = surfaces[0];
  const heading = surface
    ? querySelectorAllAcrossRoots<HTMLElement>(
        'h1, h2, h3, [role="heading"]',
        surface,
      )
        .find(isVisible)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim()
    : undefined;
  const controlRoot = surface ?? document;
  const controls = clickableCandidates(controlRoot)
    .map((candidate) =>
      (candidate.getAttribute('aria-label') || candidate.textContent || '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 6);
  const documentLocations = getAccessibleLinkedInDocuments()
    .map((currentDocument) => {
      try {
        return currentDocument.location.pathname;
      } catch {
        return 'cross-origin';
      }
    })
    .slice(0, 4);
  const parts = [
    `runner: ${LINKEDIN_INVITATION_AUTOMATION_REVISION}`,
    `roots: ${accessibleRoots.length}`,
    `documents: ${documentLocations.join(', ') || 'none'}`,
    heading ? `title: ${heading}` : '',
    controls.length > 0 ? `controls: ${controls.join(', ')}` : '',
  ].filter(Boolean);

  return ` (${parts.join('; ').slice(0, 500)})`;
};

type InvitationFlowResult =
  | { dialog: HTMLElement; errorMessage: null }
  | { dialog: null; errorMessage: string };

const waitForInvitationFlow = async (): Promise<InvitationFlowResult> => {
  const deadline = Date.now() + 4_000;
  const clickedControls = new WeakSet<HTMLElement>();

  while (Date.now() < deadline) {
    const dialog = findInvitationDialog();

    if (dialog) {
      return { dialog, errorMessage: null };
    }

    const blockReason = getLinkedInAutomationBlockReason();

    if (blockReason) {
      return { dialog: null, errorMessage: blockReason };
    }

    const relationshipPrompt = findRelationshipPrompt();

    if (relationshipPrompt) {
      const promptText = normalizedText(relationshipPrompt);

      if (RELATIONSHIP_MESSAGE_FIRST_PATTERN.test(promptText)) {
        return {
          dialog: null,
          errorMessage:
            'LinkedIn requires a message before this member can receive a connection invitation',
        };
      }

      const truthfulOption = findTruthfulRelationshipOption(relationshipPrompt);

      if (!truthfulOption) {
        return {
          dialog: null,
          errorMessage:
            'LinkedIn asked how you know this member but did not offer a truthful Other or We don’t know each other option',
        };
      }

      if (!clickedControls.has(truthfulOption)) {
        clickedControls.add(truthfulOption);
        truthfulOption.click();
      } else {
        const advanceControl =
          findRelationshipAdvanceControl(relationshipPrompt);

        if (advanceControl && !clickedControls.has(advanceControl)) {
          clickedControls.add(advanceControl);
          advanceControl.click();
        }
      }
    }

    await wait(150);
  }

  return {
    dialog: null,
    errorMessage: `LinkedIn did not open a recognized invitation dialog${summarizeVisibleConnectionSurface()}`,
  };
};

const hasInvitationSentConfirmation = (): boolean => {
  const confirmationPattern =
    /(?:invitation|connection request) (?:was )?sent/i;

  return getAccessibleLinkedInRoots().some((currentRoot) =>
    LINKEDIN_SELECTORS.confirmation.some((selector) =>
      [...currentRoot.querySelectorAll<HTMLElement>(selector)].some(
        (element) =>
          isVisible(element) &&
          confirmationPattern.test(normalizedText(element)),
      ),
    ),
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
  const textareaWindow = textarea.ownerDocument.defaultView;
  const valueSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(textarea) as object,
    'value',
  )?.set;

  valueSetter?.call(textarea, value);
  textarea.dispatchEvent(
    new (textareaWindow?.Event ?? Event)('input', { bubbles: true }),
  );
  textarea.dispatchEvent(
    new (textareaWindow?.Event ?? Event)('change', { bubbles: true }),
  );
};

const setContentEditableValue = (element: HTMLElement, value: string): void => {
  const elementWindow = element.ownerDocument.defaultView;
  const InputEventConstructor = elementWindow?.InputEvent ?? InputEvent;

  element.focus();
  element.replaceChildren(element.ownerDocument.createTextNode(value));
  element.dispatchEvent(
    new InputEventConstructor('input', {
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

  const visibleText = getAccessibleLinkedInDocuments()
    .map((currentDocument) => currentDocument.body?.innerText ?? '')
    .join(' ')
    .toLowerCase();
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
  connectSource: 'DIRECT' | 'MENU',
): Promise<{ confirmed: boolean; reason: string | null }> => {
  const deadline = Date.now() + SEND_CONFIRMATION_TIMEOUT_MILLISECONDS;
  let didInspectOverflowMenu = false;

  while (Date.now() < deadline) {
    const blockReason = getLinkedInAutomationBlockReason();

    if (blockReason) {
      return { confirmed: false, reason: blockReason };
    }

    const activeDialog = findInvitationDialog();
    const isDialogClosed =
      (!dialog.isConnected || !isVisible(dialog)) && activeDialog === null;

    if (isDialogClosed) {
      const controls = getProfileActionControls();

      if (
        controls.pending ||
        detectConnectionDegree() === 'FIRST' ||
        hasInvitationSentConfirmation()
      ) {
        return { confirmed: true, reason: null };
      }

      if (connectSource === 'DIRECT' && controls.connect) {
        return {
          confirmed: false,
          reason:
            'LinkedIn closed the invitation dialog but still offers Connect',
        };
      }

      if (
        connectSource === 'MENU' &&
        !didInspectOverflowMenu &&
        controls.more
      ) {
        didInspectOverflowMenu = true;
        const controlsBeforeOpening = new Set([
          ...findControls('connect'),
          ...findControls('pending'),
        ]);

        controls.more.click();
        const menuControl = await waitForElement(
          () =>
            findControlInOpenMenu('pending', controlsBeforeOpening) ??
            findControlInOpenMenu('connect', controlsBeforeOpening),
          1_500,
        );

        if (menuControl) {
          if (matchesControl(menuControl, CONTROL_PATTERNS.pending)) {
            return { confirmed: true, reason: null };
          }

          return {
            confirmed: false,
            reason:
              'LinkedIn closed the invitation dialog but the profile menu still offers Connect',
          };
        }
      }
    }

    await wait(250);
  }

  return {
    confirmed: false,
    reason:
      'LinkedIn did not show Pending or another confirmation that the invitation was sent',
  };
};

export const sendConnectionRequest = async (
  noteText: string,
): Promise<LinkedInAutomationResult> => {
  const blockReason = getLinkedInAutomationBlockReason();

  if (blockReason) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: blockReason,
    };
  }

  const normalizedNoteText = noteText?.trim() ?? '';

  if (normalizedNoteText.length > LINKEDIN_CONNECTION_NOTE_MAX_LENGTH) {
    return {
      status: 'FAILED',
      connectionState: 'NOT_CONNECTED',
      errorMessage: `Connection notes must be ${LINKEDIN_CONNECTION_NOTE_MAX_LENGTH} characters or fewer`,
    };
  }

  const controls = getProfileActionControls();
  const degree = detectConnectionDegree();
  let dialog = findInvitationDialog();
  let connectSource: 'DIRECT' | 'MENU' = controls.connect ? 'DIRECT' : 'MENU';

  if (!dialog) {
    // Skipping happens only on positive evidence. An unreadable page is
    // reported as a failure so the enrollment surfaces the problem instead of
    // silently recording a connection that was never requested.
    if (controls.pending) {
      return { status: 'SKIPPED', connectionState: 'PENDING' };
    }

    // A first-degree badge on LinkedIn is authoritative, and attempting
    // another invitation is impossible.
    if (degree === 'FIRST') {
      return { status: 'SKIPPED', connectionState: 'CONNECTED' };
    }

    let connectButton = controls.connect;

    if (!connectButton) {
      const moreButton = controls.more;

      if (!moreButton) {
        return {
          status: 'FAILED',
          connectionState: 'UNKNOWN',
          errorMessage:
            'Could not find a recognized Connect or More control on the profile',
        };
      }

      const connectControlsBeforeOpening = new Set(findControls('connect'));

      moreButton.click();
      connectSource = 'MENU';
      connectButton = await waitForElement(() =>
        findControlInOpenMenu('connect', connectControlsBeforeOpening),
      );
    }

    if (!connectButton) {
      return {
        status: 'FAILED',
        connectionState: 'UNKNOWN',
        errorMessage: 'Connect was not available in the profile actions menu',
      };
    }

    connectButton.click();
    const invitationFlow = await waitForInvitationFlow();
    dialog = invitationFlow.dialog;

    if (!dialog) {
      return {
        status: 'FAILED',
        connectionState: 'UNKNOWN',
        errorMessage:
          invitationFlow.errorMessage ??
          'LinkedIn did not open a recognized invitation dialog',
      };
    }
  }

  let currentDialog = dialog;

  if (normalizedNoteText.length > 0) {
    // Some invitation dialogs expose the note field directly, so a missing
    // "Add a note" button is only a failure when no textarea appears either.
    const addNoteButton = findControl('addNote', dialog);

    addNoteButton?.click();

    const textarea = await waitForElement(() => {
      currentDialog = findInvitationDialog() ?? currentDialog;

      return findVisibleElement<HTMLTextAreaElement>(
        LINKEDIN_SELECTORS.noteTextarea,
        currentDialog,
      );
    });

    if (!textarea) {
      return {
        status: 'FAILED',
        connectionState: 'NOT_CONNECTED',
        errorMessage: 'The invitation note field was not recognized',
      };
    }

    setTextareaValue(textarea, normalizedNoteText);

    const sendButton = await waitForElement(() => {
      currentDialog = findInvitationDialog() ?? currentDialog;
      const control = findControl('send', currentDialog);

      return control && isEnabledControl(control) ? control : null;
    });

    if (!sendButton) {
      return {
        status: 'FAILED',
        connectionState: 'NOT_CONNECTED',
        errorMessage: 'The invitation dialog did not contain Send',
      };
    }

    sendButton.click();
  } else {
    const sendButton = await waitForElement(() => {
      currentDialog = findInvitationDialog() ?? currentDialog;
      const control =
        findControl('sendWithoutNote', currentDialog) ??
        findControl('send', currentDialog);

      return control && isEnabledControl(control) ? control : null;
    });

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

  const { confirmed, reason } = await confirmInvitationSent(
    dialog,
    connectSource,
  );

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
  const sendConfirmationDeadline =
    Date.now() + SEND_CONFIRMATION_TIMEOUT_MILLISECONDS;

  while (Date.now() < sendConfirmationDeadline) {
    const postSendBlockReason = getLinkedInAutomationBlockReason();

    if (postSendBlockReason) {
      return {
        status: 'FAILED',
        connectionState: 'UNKNOWN',
        errorMessage: postSendBlockReason,
      };
    }

    const currentInputText =
      input instanceof HTMLTextAreaElement
        ? input.value.trim()
        : (input.textContent ?? '').trim();
    const didComposerClose =
      !composer.isConnected || !input.isConnected || !isVisible(composer);
    const didInputClear = currentInputText.length === 0;
    const hasMessageSentToast = getAccessibleLinkedInRoots().some(
      (currentRoot) =>
        LINKEDIN_SELECTORS.confirmation.some((selector) =>
          [...currentRoot.querySelectorAll<HTMLElement>(selector)].some(
            (element) =>
              isVisible(element) &&
              /message (?:was )?sent/i.test(normalizedText(element)),
          ),
        ),
    );

    if (didComposerClose || didInputClear || hasMessageSentToast) {
      return { status: 'COMPLETED', connectionState: 'CONNECTED' };
    }

    await wait(150);
  }

  return {
    status: 'FAILED',
    connectionState: 'CONNECTED',
    errorMessage:
      'LinkedIn did not confirm that the direct message was sent; it will not be retried automatically',
  };
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
  const blockReason = getLinkedInAutomationBlockReason();

  if (blockReason) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: blockReason,
    };
  }

  const profileHandle = getProfileHandle(profileUrl);

  if (!profileHandle) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: 'The LinkedIn profile URL did not contain a profile handle',
    };
  }

  const currentProfileHandle = getProfileHandle(window.location.href);

  if (currentProfileHandle !== profileHandle) {
    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: 'The runner was not on the LinkedIn profile to withdraw',
    };
  }

  const degree = detectConnectionDegree();

  if (degree === 'FIRST') {
    return { status: 'SKIPPED', connectionState: 'CONNECTED' };
  }

  const controls = getProfileActionControls();
  let pendingControl = controls.pending;

  if (!pendingControl && controls.more) {
    const controlsBeforeOpening = new Set(findControls('pending'));

    controls.more.click();
    pendingControl = await waitForElement(() =>
      findControlInOpenMenu('pending', controlsBeforeOpening),
    );
  }

  if (!pendingControl) {
    if (controls.connect || degree === 'SECOND' || degree === 'THIRD') {
      return { status: 'SKIPPED', connectionState: 'NOT_CONNECTED' };
    }

    return {
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage:
        'LinkedIn did not show Pending, Connect, or a recognized connection state on the profile',
    };
  }

  const withdrawControlsBeforeOpening = new Set(findControls('withdraw'));

  pendingControl.click();
  const withdrawButton = await waitForElement(() => {
    const currentWithdrawControls = findControls('withdraw');

    return (
      currentWithdrawControls.find(
        (candidate) => !withdrawControlsBeforeOpening.has(candidate),
      ) ?? null
    );
  });

  if (!withdrawButton) {
    return {
      status: 'FAILED',
      connectionState: 'PENDING',
      errorMessage: 'LinkedIn did not show a recognized Withdraw control',
    };
  }

  withdrawButton.click();
  const dialog = await waitForElement(
    () =>
      LINKEDIN_SELECTORS.dialog
        .flatMap((selector) =>
          querySelectorAllAcrossRoots<HTMLElement>(selector),
        )
        .find(
          (candidate) =>
            isVisible(candidate) && Boolean(findControl('withdraw', candidate)),
        ) ?? null,
  );
  const confirmButton = dialog ? findControl('withdraw', dialog) : null;

  if (!dialog || !confirmButton) {
    return {
      status: 'FAILED',
      connectionState: 'PENDING',
      errorMessage:
        'LinkedIn did not show a recognized withdrawal confirmation',
    };
  }

  confirmButton.click();

  const confirmationDeadline =
    Date.now() + SEND_CONFIRMATION_TIMEOUT_MILLISECONDS;

  while (Date.now() < confirmationDeadline) {
    const postWithdrawBlockReason = getLinkedInAutomationBlockReason();

    if (postWithdrawBlockReason) {
      return {
        status: 'FAILED',
        connectionState: 'UNKNOWN',
        errorMessage: postWithdrawBlockReason,
      };
    }

    const hasWithdrawalToast = getAccessibleLinkedInRoots().some(
      (currentRoot) =>
        LINKEDIN_SELECTORS.confirmation.some((selector) =>
          [...currentRoot.querySelectorAll<HTMLElement>(selector)].some(
            (element) =>
              isVisible(element) &&
              /invitation (?:was )?withdrawn/i.test(normalizedText(element)),
          ),
        ),
    );
    const didDialogClose = !dialog.isConnected || !isVisible(dialog);
    const hasPendingControl = Boolean(
      findControl('pending', document, { profileLevelOnly: true }),
    );

    if (hasWithdrawalToast || (didDialogClose && !hasPendingControl)) {
      return { status: 'COMPLETED', connectionState: 'WITHDRAWN' };
    }

    await wait(150);
  }

  return {
    status: 'FAILED',
    connectionState: 'PENDING',
    errorMessage: 'LinkedIn did not confirm that the invitation was withdrawn',
  };
};
