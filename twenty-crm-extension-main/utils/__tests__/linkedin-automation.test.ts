// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  detectConnectionDegree,
  isInvitationManagerPath,
  sendConnectionRequest,
} from '../linkedin-automation';

// jsdom reports zero-sized boxes, so visibility has to be forced for the
// automation's isVisible guard to behave like a rendered page.
const makeElementsVisible = () => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }),
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
      errorMessage: 'LinkedIn did not open a recognized invitation dialog',
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
