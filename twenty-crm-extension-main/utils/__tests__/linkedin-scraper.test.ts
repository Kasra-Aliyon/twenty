// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCanonicalLinkedInPageUrl,
  getLinkedInPageType,
  scrapeCompanyPage,
} from '../linkedin-scraper';

const setLinkedInLocation = (href: string) => {
  vi.stubGlobal('window', {
    location: { href },
  });
};

describe('LinkedIn company page scraping', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('scrapes the current public company page layout', () => {
    setLinkedInLocation(
      'https://www.linkedin.com/company/twenty/about/?trk=organization_guest',
    );
    document.head.innerHTML = `
      <meta property="og:title" content="Twenty | LinkedIn" />
      <meta property="og:image" content="https://media.licdn.com/twenty-logo.png" />
    `;
    document.body.innerHTML = `
      <main>
        <h1 class="top-card-layout__title">Twenty</h1>
        <h2 class="top-card-layout__headline">
          Technology, Information and Internet
        </h2>
        <h4 class="top-card-layout__second-subline">Open Source CRM</h4>
        <img
          class="top-card-layout__entity-image"
          src="https://media.licdn.com/twenty-logo.png"
        />
        <a
          href="/search/results/people/?facetCurrentCompany=%5B319022%5D"
        >
          Discover all 34 employees
        </a>
        <dl>
          <dt>Website</dt>
          <dd>
            <a
              href="https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Ftwenty%2Ecom&amp;trk=about_website"
            >
              https://twenty.com
              External link for Twenty
            </a>
          </dd>
          <dt>Industry</dt>
          <dd>Technology, Information and Internet</dd>
          <dt>Company size</dt>
          <dd>2-10 employees</dd>
        </dl>
      </main>
    `;

    expect(scrapeCompanyPage()).toEqual({
      type: 'company',
      linkedinUrl: 'https://www.linkedin.com/company/twenty',
      name: 'Twenty',
      website: 'https://twenty.com',
      industry: 'Technology, Information and Internet',
      employeeCount: '34 employees',
      logoUrl: 'https://media.licdn.com/twenty-logo.png',
      description: 'Open Source CRM',
    });
  });

  it('keeps support for the signed-in company layout', () => {
    setLinkedInLocation('https://www.linkedin.com/company/acme/');
    document.body.innerHTML = `
      <main>
        <h1 class="org-top-card-summary__title">Acme</h1>
        <div class="org-top-card-summary-info-list__info-item">
          Software Development
        </div>
        <div class="org-top-card-summary-info-list__info-item">
          1,001-5,000 employees
        </div>
        <a
          data-control-name="top_card_link_website"
          href="https://acme.example"
        >
          Visit website
        </a>
        <img
          class="org-top-card-primary-content__logo"
          src="https://media.licdn.com/acme-logo.png"
        />
        <div class="org-top-card-summary__tagline">Build everything.</div>
      </main>
    `;

    expect(scrapeCompanyPage()).toEqual({
      type: 'company',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      name: 'Acme',
      website: 'https://acme.example/',
      industry: 'Software Development',
      employeeCount: '1,001-5,000 employees',
      logoUrl: 'https://media.licdn.com/acme-logo.png',
      description: 'Build everything.',
    });
  });

  it('canonicalizes company subpages for duplicate checks and CRM links', () => {
    const url =
      'https://fr.linkedin.com/company/twenty/posts/?feedView=all#updates';

    expect(getLinkedInPageType(url)).toBe('company');
    expect(getCanonicalLinkedInPageUrl(url)).toBe(
      'https://www.linkedin.com/company/twenty',
    );
    expect(
      getLinkedInPageType('https://notlinkedin.com/company/twenty'),
    ).toBeNull();
  });
});
