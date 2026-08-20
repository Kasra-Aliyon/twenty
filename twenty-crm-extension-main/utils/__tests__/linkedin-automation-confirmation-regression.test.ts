// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sendConnectionRequest,
  sendDirectMessage,
  withdrawConnectionRequest,
} from '../linkedin-automation';

const makeElementsVisible = () => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
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

describe('LinkedIn durable action confirmation regressions', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/in/ada-lovelace/');
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not reuse a stale invitation-sent toast as confirmation', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="connect" aria-label="Connect with Ada">Connect</button>
        </section>
      </main>
      <div class="artdeco-toast-item">Invitation sent</div>
      <div id="dialog-host"></div>
    `);

    document
      .querySelector<HTMLButtonElement>('#connect')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#dialog-host')!.innerHTML = `
          <div role="dialog">
            <button id="send" aria-label="Send without a note">Send</button>
          </div>
        `;
        document
          .querySelector<HTMLButtonElement>('#send')!
          .addEventListener('click', () => {
            document
              .querySelector<HTMLElement>('#dialog-host')!
              .replaceChildren();
          });
      });

    const resultPromise = sendConnectionRequest('');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('does not report a direct message as sent when only the composer clears', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">1st</span>
          <button id="message" aria-label="Message Ada">Message</button>
        </section>
      </main>
      <div id="composer-host"></div>
    `);

    document
      .querySelector<HTMLButtonElement>('#message')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#composer-host')!.innerHTML = `
          <form class="msg-form">
            <textarea name="message"></textarea>
            <button type="submit">Send</button>
          </form>
        `;
        const form = document.querySelector<HTMLFormElement>('.msg-form')!;

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          form.querySelector<HTMLTextAreaElement>('textarea')!.value = '';
        });
      });

    const resultPromise = sendDirectMessage('Hello Ada');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({
      status: 'FAILED',
      connectionState: 'CONNECTED',
      errorMessage: expect.stringContaining(
        'will not be retried automatically',
      ),
    });
  });

  it('accepts a newly observed matching outbound message as send confirmation', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">1st</span>
          <button id="message" aria-label="Message Ada">Message</button>
        </section>
      </main>
      <div id="composer-host"></div>
      <div id="conversation"></div>
    `);

    document
      .querySelector<HTMLButtonElement>('#message')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#composer-host')!.innerHTML = `
          <form class="msg-form">
            <textarea name="message"></textarea>
            <button type="submit">Send</button>
          </form>
        `;
        document
          .querySelector<HTMLFormElement>('.msg-form')!
          .addEventListener('submit', (event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>('#conversation')!.innerHTML = `
              <div data-message-direction="outbound" data-message-id="new-message">
                <span data-message-body>Hello Ada</span>
              </div>
            `;
          });
      });

    const resultPromise = sendDirectMessage('Hello Ada');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      status: 'COMPLETED',
      connectionState: 'CONNECTED',
    });
  });

  it('does not reuse a stale message-sent toast as confirmation', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">1st</span>
          <button id="message" aria-label="Message Ada">Message</button>
        </section>
      </main>
      <div class="artdeco-toast-item">Message sent</div>
      <div id="composer-host"></div>
    `);

    document
      .querySelector<HTMLButtonElement>('#message')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#composer-host')!.innerHTML = `
          <form class="msg-form">
            <textarea name="message"></textarea>
            <button type="submit">Send</button>
          </form>
        `;
        document
          .querySelector<HTMLFormElement>('.msg-form')!
          .addEventListener('submit', (event) => {
            event.preventDefault();
            document.querySelector<HTMLTextAreaElement>('textarea')!.value = '';
          });
      });

    const resultPromise = sendDirectMessage('Hello Ada');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('does not treat re-rendered descendants of an old outbound message as a new send', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">1st</span>
          <button id="message" aria-label="Message Ada">Message</button>
        </section>
      </main>
      <div id="composer-host"></div>
      <ol id="conversation">
        <li data-event-urn="urn:li:msg_event:old-message">
          <div data-message-direction="outbound">Hello Ada</div>
        </li>
      </ol>
    `);

    document
      .querySelector<HTMLButtonElement>('#message')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#composer-host')!.innerHTML = `
          <form class="msg-form">
            <textarea name="message"></textarea>
            <button type="submit">Send</button>
          </form>
        `;
        document
          .querySelector<HTMLFormElement>('.msg-form')!
          .addEventListener('submit', (event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>(
              '[data-event-urn="urn:li:msg_event:old-message"]',
            )!.innerHTML = `
              <div data-message-direction="outbound">
                <span data-message-body>Hello Ada</span>
                <p>Hello Ada</p>
              </div>
            `;
          });
      });

    const resultPromise = sendDirectMessage('Hello Ada');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('accepts a fresh invitation toast while a stale matching toast remains', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="connect" aria-label="Connect with Ada">Connect</button>
        </section>
      </main>
      <div class="artdeco-toast-item">Invitation sent</div>
      <div id="dialog-host"></div>
      <div id="fresh-toast-host"></div>
    `);

    document
      .querySelector<HTMLButtonElement>('#connect')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#dialog-host')!.innerHTML = `
          <div role="dialog">
            <button id="send" aria-label="Send without a note">Send</button>
          </div>
        `;
        document
          .querySelector<HTMLButtonElement>('#send')!
          .addEventListener('click', () => {
            document
              .querySelector<HTMLElement>('#dialog-host')!
              .replaceChildren();
            document.querySelector<HTMLElement>(
              '#fresh-toast-host',
            )!.innerHTML = '<div role="status">Invitation sent</div>';
          });
      });

    const resultPromise = sendConnectionRequest('');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      status: 'COMPLETED',
      connectionState: 'PENDING',
    });
  });

  it('accepts a fresh message toast while a stale matching toast remains', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">1st</span>
          <button id="message" aria-label="Message Ada">Message</button>
        </section>
      </main>
      <div class="artdeco-toast-item">Message sent</div>
      <div id="composer-host"></div>
      <div id="fresh-toast-host"></div>
    `);

    document
      .querySelector<HTMLButtonElement>('#message')!
      .addEventListener('click', () => {
        document.querySelector<HTMLElement>('#composer-host')!.innerHTML = `
          <form class="msg-form">
            <textarea name="message"></textarea>
            <button type="submit">Send</button>
          </form>
        `;
        document
          .querySelector<HTMLFormElement>('.msg-form')!
          .addEventListener('submit', (event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>(
              '#fresh-toast-host',
            )!.innerHTML = '<div role="status">Message sent</div>';
          });
      });

    const resultPromise = sendDirectMessage('Hello Ada');

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      status: 'COMPLETED',
      connectionState: 'CONNECTED',
    });
  });

  it('accepts a fresh withdrawal toast while a stale matching toast remains', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="pending" aria-label="Pending invitation">Pending</button>
        </section>
      </main>
      <div class="artdeco-toast-item">Invitation withdrawn</div>
      <div id="overlay-host"></div>
      <div id="fresh-toast-host"></div>
    `);
    const overlayHost = document.querySelector<HTMLElement>('#overlay-host')!;

    document
      .querySelector<HTMLButtonElement>('#pending')!
      .addEventListener('click', () => {
        overlayHost.innerHTML = `
          <div role="menu"><button id="withdraw">Withdraw</button></div>
        `;
        overlayHost
          .querySelector<HTMLButtonElement>('#withdraw')!
          .addEventListener('click', () => {
            overlayHost.innerHTML = `
              <div role="dialog"><button id="confirm-withdraw">Withdraw</button></div>
            `;
            overlayHost
              .querySelector<HTMLButtonElement>('#confirm-withdraw')!
              .addEventListener('click', () => {
                overlayHost.replaceChildren();
                document.querySelector<HTMLElement>(
                  '#fresh-toast-host',
                )!.innerHTML = '<div role="status">Invitation withdrawn</div>';
              });
          });
      });

    const resultPromise = withdrawConnectionRequest(
      'https://www.linkedin.com/in/ada-lovelace/',
    );

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      status: 'COMPLETED',
      connectionState: 'WITHDRAWN',
    });
  });

  it('does not report withdrawal from dialog and pending-control disappearance alone', async () => {
    renderProfile(`
      <main>
        <section class="pv-top-card">
          <h1>Ada Lovelace</h1>
          <span class="dist-value">2nd</span>
          <button id="pending" aria-label="Pending invitation">Pending</button>
        </section>
      </main>
      <div id="overlay-host"></div>
    `);
    const pendingButton =
      document.querySelector<HTMLButtonElement>('#pending')!;
    const overlayHost = document.querySelector<HTMLElement>('#overlay-host')!;

    pendingButton.addEventListener('click', () => {
      overlayHost.innerHTML = `
        <div role="menu"><button id="withdraw">Withdraw</button></div>
      `;
      overlayHost
        .querySelector<HTMLButtonElement>('#withdraw')!
        .addEventListener('click', () => {
          overlayHost.innerHTML = `
            <div role="dialog"><button id="confirm-withdraw">Withdraw</button></div>
          `;
          overlayHost
            .querySelector<HTMLButtonElement>('#confirm-withdraw')!
            .addEventListener('click', () => {
              overlayHost.replaceChildren();
              pendingButton.remove();
            });
        });
    });

    const resultPromise = withdrawConnectionRequest(
      'https://www.linkedin.com/in/ada-lovelace/',
    );

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({
      status: 'FAILED',
      connectionState: 'PENDING',
    });
  });
});
