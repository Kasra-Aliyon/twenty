// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  detectConnectionDegree,
  isInvitationManagerPath,
  sendConnectionRequest,
} from '../linkedin-automation';

// jsdom reports zero-sized boxes, so visibility has to be forced for the
// automation's isVisible guard to behave like a rendered page.
const makeElementsVisible = (targetDocument: Document = document) => {
  const htmlElementPrototype =
    targetDocument.defaultView?.HTMLElement.prototype ?? HTMLElement.prototype;

  Object.defineProperty(htmlElementPrototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
    }),
  });
};

const renderProfile = (html: string) => {
  document.body.innerHTML = html;
  makeElementsVisible();
};

describe('detectConnectionDegree', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the degree of the viewed profile', () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
        </section>
      </main>
    `);

    expect(detectConnectionDegree()).toBe('SECOND');
  });

  // Recommendation rails render other people's degree badges inside main.
  // Reading those as the viewed profile's own degree is what caused connection
  // requests to be skipped as "already connected" without ever being sent.
  it('ignores degree badges belonging to recommended profiles', () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
        </section>
        <section class="more-profiles">
          <ul>
            <li class="discover-entity"><span class="dist-value">1st</span>Grace Hopper</li>
          </ul>
        </section>
      </main>
    `);

    expect(detectConnectionDegree()).toBe('UNKNOWN');
  });

  it('does not treat prose mentioning 1st as a degree badge', () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <p class="distance-note">Ranked 1st in her cohort</p>
        </section>
      </main>
    `);

    expect(detectConnectionDegree()).toBe('UNKNOWN');
  });
});

describe('sendConnectionRequest', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds Connect through its accessible label rather than exact text', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button aria-label="Invite Ada Lovelace to connect"><span>Connect</span></button>
        </section>
      </main>
    `);

    const result = await sendConnectionRequest('', true);

    // No dialog is rendered in this fixture, so the run stops there. Reaching
    // that point proves the Connect control was recognised and clicked.
    expect(result.status).toBe('FAILED');
    expect(result).toMatchObject({
      errorMessage: expect.stringContaining(
        'LinkedIn did not open a recognized invitation dialog',
      ),
    });
    expect(result).toMatchObject({
      errorMessage: expect.stringContaining('runner: 2026-08-07.2'),
    });
  });

  it('skips a profile with an outstanding invitation', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button aria-label="Pending, click to withdraw invitation sent to Ada Lovelace">Pending</button>
        </section>
      </main>
    `);

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'SKIPPED',
      connectionState: 'PENDING',
    });
  });

  it('skips a confirmed first-degree connection', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">1st</span>
          <button aria-label="Message Ada Lovelace">Message</button>
        </section>
      </main>
    `);

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'SKIPPED',
      connectionState: 'CONNECTED',
    });
  });

  // An unreadable page must surface as a failure. Reporting it as a skip
  // recorded a connection state that was never observed.
  it('fails rather than skipping when the profile cannot be read', async () => {
    renderProfile('<main><section><h1>Ada Lovelace</h1></section></main>');

    const result = await sendConnectionRequest('', true);

    expect(result.status).toBe('FAILED');
    expect(result.connectionState).toBe('UNKNOWN');
  });

  it('rejects an over-long note before touching the page', async () => {
    renderProfile('<main><section class="pv-top-card"></section></main>');

    const result = await sendConnectionRequest('x'.repeat(201), true);

    expect(result).toMatchObject({
      status: 'FAILED',
      connectionState: 'NOT_CONNECTED',
    });
  });

  it('sends without a note from the current invitation choice sheet', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Lynne Isbell</h1>
          <span class="dist-value">2nd</span>
          <button id="connect" aria-label="Invite Lynne Isbell to connect">Connect</button>
        </section>
      </main>
      <div id="modal-host"></div>
    `);
    const connectButton =
      document.querySelector<HTMLButtonElement>('#connect')!;
    let didClickSendWithoutNote = false;

    connectButton.addEventListener('click', () => {
      document.querySelector<HTMLElement>('#modal-host')!.innerHTML = `
        <section class="new-invitation-sheet">
          <h2>Add a note to your invitation?</h2>
          <p>Personalize your invitation to Lynne Isbell by adding a note.</p>
          <button>Add a note</button>
          <button id="send-without-note">Send without a note</button>
        </section>
      `;
      document
        .querySelector<HTMLButtonElement>('#send-without-note')!
        .addEventListener('click', () => {
          didClickSendWithoutNote = true;
          document.querySelector('.new-invitation-sheet')?.remove();
          connectButton.textContent = 'Pending';
          connectButton.setAttribute(
            'aria-label',
            'Pending, click to withdraw invitation sent to Lynne Isbell',
          );
        });
    });

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(didClickSendWithoutNote).toBe(true);
  });

  it('sends without a note when LinkedIn mounts the choice sheet in its preload frame', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Lynne Isbell</h1>
          <span class="dist-value">3rd</span>
          <button id="more" aria-label="More actions">More</button>
        </section>
      </main>
      <div id="overlay-host"></div>
      <div id="frame-host"></div>
    `);
    const moreButton = document.querySelector<HTMLButtonElement>('#more')!;
    const overlayHost = document.querySelector<HTMLElement>('#overlay-host')!;
    const frameHost = document.querySelector<HTMLElement>('#frame-host')!;
    let isPending = false;
    let didClickSendWithoutNote = false;

    const renderMenu = () => {
      overlayHost.innerHTML = isPending
        ? '<div role="menu"><button aria-label="Pending invitation">Pending</button></div>'
        : '<div role="menu"><button id="menu-connect">Connect</button></div>';

      overlayHost
        .querySelector<HTMLButtonElement>('#menu-connect')
        ?.addEventListener('click', () => {
          overlayHost.replaceChildren();
          const invitationFrame = document.createElement('iframe');

          invitationFrame.dataset.linkedinPath = '/preload/';
          frameHost.appendChild(invitationFrame);

          const frameDocument = invitationFrame.contentDocument!;

          makeElementsVisible(frameDocument);
          frameDocument.body.innerHTML = `
            <section class="preload-invitation-sheet">
              <h2>Add a note to your invitation?</h2>
              <p>Personalize your invitation to Lynne Isbell by adding a note.</p>
              <button>Add a note</button>
              <button id="send-without-note">Send without a note</button>
            </section>
          `;
          frameDocument
            .querySelector<HTMLButtonElement>('#send-without-note')!
            .addEventListener('click', () => {
              didClickSendWithoutNote = true;
              isPending = true;
              invitationFrame.remove();
            });
        });
    };

    moreButton.addEventListener('click', renderMenu);

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(didClickSendWithoutNote).toBe(true);
  });

  it('sends from a shadow-root preload sheet while the More menu remains open', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Wilson Joe, PhD, CMPP</h1>
          <span class="dist-value">3rd</span>
          <button id="more" aria-label="More actions">More</button>
        </section>
      </main>
      <div id="overlay-host"></div>
      <div id="frame-host"></div>
    `);
    const moreButton = document.querySelector<HTMLButtonElement>('#more')!;
    const overlayHost = document.querySelector<HTMLElement>('#overlay-host')!;
    const frameHost = document.querySelector<HTMLElement>('#frame-host')!;
    let didClickSendWithoutNote = false;

    moreButton.addEventListener('click', () => {
      overlayHost.innerHTML = `
        <div role="menu">
          <button id="menu-connect">Connect</button>
        </div>
      `;
      overlayHost
        .querySelector<HTMLButtonElement>('#menu-connect')!
        .addEventListener('click', () => {
          const invitationFrame = document.createElement('iframe');

          Object.defineProperty(invitationFrame, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
              width: 0,
              height: 0,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }),
          });
          frameHost.appendChild(invitationFrame);

          const frameDocument = invitationFrame.contentDocument!;

          makeElementsVisible(frameDocument);
          const sheetHost = frameDocument.createElement('div');
          const shadowRoot = sheetHost.attachShadow({ mode: 'open' });

          frameDocument.body.appendChild(sheetHost);
          shadowRoot.innerHTML = `
            <section class="preload-invitation-sheet">
              <h2>Add a note to your invitation?</h2>
              <p>Personalize your invitation to Wilson Joe, PhD, CMPP by adding a note.</p>
              <button>Add a note</button>
              <button id="send-without-note">Send without a note</button>
            </section>
          `;
          shadowRoot
            .querySelector<HTMLButtonElement>('#send-without-note')!
            .addEventListener('click', () => {
              didClickSendWithoutNote = true;
              overlayHost.innerHTML = `
                <div role="menu">
                  <button aria-label="Pending invitation">Pending</button>
                </div>
              `;
              invitationFrame.remove();
            });
        });
    });

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(didClickSendWithoutNote).toBe(true);
  });

  it('resumes an invitation when the preload sheet is already open', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Lynne Isbell</h1>
          <span class="dist-value">3rd</span>
          <button id="more" aria-label="More actions">More</button>
        </section>
      </main>
      <div id="overlay-host"></div>
      <iframe id="invitation-frame"></iframe>
    `);
    const moreButton = document.querySelector<HTMLButtonElement>('#more')!;
    const overlayHost = document.querySelector<HTMLElement>('#overlay-host')!;
    const invitationFrame =
      document.querySelector<HTMLIFrameElement>('#invitation-frame')!;
    const frameDocument = invitationFrame.contentDocument!;
    let isPending = false;
    let didClickSendWithoutNote = false;

    makeElementsVisible(frameDocument);
    frameDocument.body.innerHTML = `
      <section class="preload-invitation-sheet">
        <h2>Add a note to your invitation?</h2>
        <button>Add a note</button>
        <button id="send-without-note">Send without a note</button>
      </section>
    `;
    frameDocument
      .querySelector<HTMLButtonElement>('#send-without-note')!
      .addEventListener('click', () => {
        didClickSendWithoutNote = true;
        isPending = true;
        invitationFrame.remove();
      });
    moreButton.addEventListener('click', () => {
      overlayHost.innerHTML = isPending
        ? '<div role="menu"><button aria-label="Pending invitation">Pending</button></div>'
        : '<div role="menu"><button>Connect</button></div>';
    });

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(didClickSendWithoutNote).toBe(true);
  });

  it('uses LinkedIn’s profile-level custom-invite link as Connect', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Holly Richendrfer, Ph.D., CMPP</h1>
          <span class="dist-value">2nd</span>
          <a
            id="connect-link"
            href="/preload/custom-invite/?vanityName=hollyrichendrfer"
            aria-label="Invite Holly Richendrfer, Ph.D., CMPP to connect"
          >Connect</a>
          <button aria-label="More actions">More</button>
        </section>
      </main>
      <div id="modal-host"></div>
    `);
    const connectLink =
      document.querySelector<HTMLAnchorElement>('#connect-link')!;
    let didClickConnectLink = false;

    connectLink.addEventListener('click', (event) => {
      event.preventDefault();
      didClickConnectLink = true;
      document.querySelector<HTMLElement>('#modal-host')!.innerHTML = `
        <section class="new-invitation-sheet">
          <h2>Add a note to your invitation?</h2>
          <button>Add a note</button>
          <button id="send-without-note">Send without a note</button>
        </section>
      `;
      document
        .querySelector<HTMLButtonElement>('#send-without-note')!
        .addEventListener('click', () => {
          document.querySelector('.new-invitation-sheet')?.remove();
          connectLink.textContent = 'Pending';
          connectLink.setAttribute('aria-label', 'Pending invitation');
        });
    });

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(didClickConnectLink).toBe(true);
  });

  it('uses a truthful option when LinkedIn asks how the member is known', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Wilson Joe</h1>
          <span class="dist-value">2nd</span>
          <button id="connect" aria-label="Invite Wilson Joe to connect">Connect</button>
        </section>
      </main>
      <div id="modal-host"></div>
    `);
    const connectButton =
      document.querySelector<HTMLButtonElement>('#connect')!;
    let didChooseOther = false;

    connectButton.addEventListener('click', () => {
      document.querySelector<HTMLElement>('#modal-host')!.innerHTML = `
        <section role="dialog">
          <h2>How do you know Wilson?</h2>
          <button>Colleague</button>
          <button id="other">Other</button>
          <button id="continue" disabled>Continue</button>
        </section>
      `;
      const otherButton = document.querySelector<HTMLButtonElement>('#other')!;
      const continueButton =
        document.querySelector<HTMLButtonElement>('#continue')!;

      otherButton.addEventListener('click', () => {
        didChooseOther = true;
        continueButton.disabled = false;
      });
      continueButton.addEventListener('click', () => {
        document.querySelector<HTMLElement>('#modal-host')!.innerHTML = `
          <section class="new-invitation-sheet">
            <h2>Add a note to your invitation?</h2>
            <button>Add a note</button>
            <button id="send-without-note">Send without a note</button>
          </section>
        `;
        document
          .querySelector<HTMLButtonElement>('#send-without-note')!
          .addEventListener('click', () => {
            document.querySelector('.new-invitation-sheet')?.remove();
            connectButton.textContent = 'Pending';
            connectButton.setAttribute('aria-label', 'Pending invitation');
          });
      });
    });

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(didChooseOther).toBe(true);
  });

  it('does not invent a relationship when LinkedIn offers no truthful option', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Wilson Joe</h1>
          <span class="dist-value">2nd</span>
          <button id="connect" aria-label="Invite Wilson Joe to connect">Connect</button>
        </section>
      </main>
      <div id="modal-host"></div>
    `);
    document
      .querySelector<HTMLButtonElement>('#connect')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#modal-host')!.innerHTML = `
          <section role="dialog">
            <h2>How do you know Wilson?</h2>
            <button>Colleague</button>
            <button>Classmate</button>
            <button>Friend</button>
          </section>
        `;
      });

    expect(await sendConnectionRequest('', true)).toMatchObject({
      status: 'FAILED',
      connectionState: 'UNKNOWN',
      errorMessage: expect.stringContaining('did not offer a truthful'),
    });
  });

  it('adds a note and waits for the enabled Send control', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="connect" aria-label="Invite Ada Lovelace to connect">Connect</button>
        </section>
      </main>
      <div id="modal-host"></div>
    `);
    const connectButton =
      document.querySelector<HTMLButtonElement>('#connect')!;
    let submittedNote = '';

    connectButton.addEventListener('click', () => {
      document.querySelector<HTMLElement>('#modal-host')!.innerHTML = `
        <section class="new-invitation-sheet">
          <h2>Add a note to your invitation?</h2>
          <div id="sheet-content">
            <button id="add-note">Add a note</button>
            <button>Send without a note</button>
          </div>
        </section>
      `;
      document
        .querySelector<HTMLButtonElement>('#add-note')!
        .addEventListener('click', () => {
          document.querySelector<HTMLElement>('#sheet-content')!.innerHTML = `
            <textarea name="message"></textarea>
            <button id="send" disabled>Send</button>
          `;
          const textarea = document.querySelector<HTMLTextAreaElement>(
            'textarea[name="message"]',
          )!;
          const sendButton =
            document.querySelector<HTMLButtonElement>('#send')!;

          textarea.addEventListener('input', () => {
            submittedNote = textarea.value;
            sendButton.disabled = textarea.value.length === 0;
          });
          sendButton.addEventListener('click', () => {
            document.querySelector('.new-invitation-sheet')?.remove();
            connectButton.textContent = 'Pending';
            connectButton.setAttribute('aria-label', 'Pending invitation');
          });
        });
    });

    expect(await sendConnectionRequest('  Hello Ada  ', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
    expect(submittedNote).toBe('Hello Ada');
  });

  it('finds Connect in an overflow menu without ARIA menu roles', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="more" aria-label="More actions">More</button>
        </section>
      </main>
      <div id="overlay-host"></div>
    `);
    const moreButton = document.querySelector<HTMLButtonElement>('#more')!;

    moreButton.addEventListener('click', () => {
      document.querySelector<HTMLElement>('#overlay-host')!.innerHTML = `
        <div class="new-overflow-sheet">
          <div id="menu-connect" role="button" aria-label="Connect with Ada Lovelace">Connect</div>
        </div>
      `;
      document
        .querySelector<HTMLElement>('#menu-connect')!
        .addEventListener('click', () => {
          document.querySelector<HTMLElement>('#overlay-host')!.innerHTML = `
            <section class="new-invitation-sheet">
              <h2>Add a note to your invitation?</h2>
              <button>Add a note</button>
              <button id="send-without-note">Send without a note</button>
            </section>
          `;
          document
            .querySelector<HTMLButtonElement>('#send-without-note')!
            .addEventListener('click', () => {
              document.querySelector<HTMLElement>('#overlay-host')!.innerHTML =
                `
                <div class="new-overflow-sheet">
                  <div role="button" aria-label="Pending invitation">Pending</div>
                </div>
              `;
            });
        });
    });

    expect(await sendConnectionRequest('', true)).toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
  });

  it('does not report success when a menu-based invitation has no sent confirmation', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="more" aria-label="More actions">More</button>
        </section>
      </main>
      <div id="overlay-host"></div>
    `);
    const moreButton = document.querySelector<HTMLButtonElement>('#more')!;
    const renderMenu = () => {
      document.querySelector<HTMLElement>('#overlay-host')!.innerHTML = `
        <div class="new-overflow-sheet">
          <div id="menu-connect" role="button" aria-label="Connect with Ada Lovelace">Connect</div>
        </div>
      `;
      document
        .querySelector<HTMLElement>('#menu-connect')!
        .addEventListener('click', () => {
          document.querySelector<HTMLElement>('#overlay-host')!.innerHTML = `
            <section class="new-invitation-sheet">
              <h2>Add a note to your invitation?</h2>
              <button>Add a note</button>
              <button id="send-without-note">Send without a note</button>
            </section>
          `;
          document
            .querySelector<HTMLButtonElement>('#send-without-note')!
            .addEventListener('click', renderMenu);
        });
    };

    moreButton.addEventListener('click', renderMenu);

    const result = await sendConnectionRequest('', true);

    expect(result.status).toBe('FAILED');
    expect(result).toMatchObject({
      connectionState: 'UNKNOWN',
      errorMessage: expect.stringContaining('still offers Connect'),
    });
  });
});

describe('isInvitationManagerPath', () => {
  it.each([
    '/mynetwork/invitation-manager/sent/',
    '/mynetwork/invitation-manager/sent',
    '/mynetwork/invitation-manager/',
    '/mynetwork/invite-connect/invitations/',
  ])('accepts %s', (pathname) => {
    expect(isInvitationManagerPath(pathname)).toBe(true);
  });

  it.each(['/in/ada-lovelace/', '/mynetwork/', '/feed/'])(
    'rejects %s',
    (pathname) => {
      expect(isInvitationManagerPath(pathname)).toBe(false);
    },
  );
});
