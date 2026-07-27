import type {
  LinkedInProfileData,
  LinkedInCompanyData,
  LinkedInData,
} from '../types';

const PROFILE_NAME_SELECTORS = [
  'h1.text-heading-xlarge',
  'h1.inline.t-24',
  'h1.t-24.v-align-middle',
  '.pv-top-card h1',
  '.pv-text-details__left-panel h1',
  '.ph5 h1',
  '.mt2 h1',
  'main h1',
  'section h1',
  'h1[class*="break-words"]',
];

const PROFILE_HEADLINE_SELECTORS = [
  '.pv-text-details__left-panel div.text-body-medium',
  '.pv-top-card div.text-body-medium',
  'main section div.text-body-medium.break-words',
  'div[data-generated-suggestion-target]',
  'div.text-body-medium.break-words',
];

type CurrentPositionData = {
  jobTitle?: string;
  companyName?: string;
  companyLinkedInUrl?: string;
  companyLogoUrl?: string;
};

type CompanyData = {
  name: string;
  linkedinUrl?: string;
  logoUrl?: string;
};

const CURRENT_POSITION_ARIA_LABELS = [
  'Entreprise actuelle',
  'Current company',
  'Empresa actual',
  'Aktuelles Unternehmen',
  'Empresa atual',
  'Azienda attuale',
  'Huidig bedrijf',
  'Mevcut şirket',
];

const EXPERIENCE_SECTION_HEADINGS = [
  'Experience',
  'Expérience',
  'Experiencia',
  'Berufserfahrung',
  'Experiência',
  'Esperienza',
  'Ervaring',
];

const LINKEDIN_FEED_OR_POST_SELECTOR = [
  'article',
  '.feed-shared-update-v2',
  '.profile-creator-shared-feed-update__container',
  '[data-id*="urn:li:activity"]',
  '[data-urn*="activity"]',
  'a[href*="/feed/update/"]',
  'a[href*="/posts/"]',
].join(',');

const MONTH_NAME_PATTERN =
  'Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December';

const CURRENT_DATE_PATTERN =
  /(?:present|current|aujourd'hui|aujourd’hui|heute|actualidad|presente)/i;

const DATE_RANGE_PATTERN = new RegExp(
  `(?:\\b(?:${MONTH_NAME_PATTERN})\\.?\\s+)?\\b\\d{4}\\b\\s*[-–]\\s*(?:${CURRENT_DATE_PATTERN.source}|(?:\\b(?:${MONTH_NAME_PATTERN})\\.?\\s+)?\\b\\d{4}\\b)`,
  'i',
);

const DATE_RANGE_FROM_HERE_PATTERN = new RegExp(
  `(?:\\.|\\s|^)(?:\\b(?:${MONTH_NAME_PATTERN})\\.?\\s+)?\\b\\d{4}\\b\\s*[-–]\\s*(?:${CURRENT_DATE_PATTERN.source}|(?:\\b(?:${MONTH_NAME_PATTERN})\\.?\\s+)?\\b\\d{4}\\b).*$`,
  'i',
);

const EMPLOYMENT_TYPE_PATTERN =
  /(?:full-time|part-time|self-employed|freelance|contract|temporary|internship|apprenticeship|seasonal|volunteer|trainee)/i;

const DURATION_ONLY_PATTERN =
  /^\d+\s*(?:yr|yrs|year|years|mo|mos|month|months)(?:\s+\d+\s*(?:mo|mos|month|months))?$/i;

const PROFILE_SECTION_NOISE_PATTERN =
  /^(experience|show all|show more|show less|company name|current company|current position|see more|see less|contact info|follow|message|connect)$/i;

const COMPANY_NAME_NOISE_PATTERN =
  /^(linkedin|company|current company|current position|experience|education|followers|connections|follow|message|connect|visit website|website|contact info)$/i;

const LINKEDIN_PAGE_URL_PATTERN =
  /(?:^|\/\/)(?:[a-z0-9-]+\.)*linkedin\.com\/(in|company)\/([^/?#]+)/i;

function cleanText(value: string | null | undefined): string {
  return (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimPunctuation(value: string): string {
  return cleanText(value).replace(/^[.,;:·|•\-–\s]+|[.,;:·|•\-–\s]+$/g, '');
}

function normalizeForComparison(value: string): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeCompanyNameForComparison(value: string): string {
  return normalizeForComparison(value)
    .replace(
      /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|ag|sas|sarl|plc|bv|nv|oy|ab)\b\.?/g,
      '',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function areEquivalentCompanyNames(
  leftValue: string,
  rightValue: string,
): boolean {
  const normalizedLeftValue = normalizeCompanyNameForComparison(leftValue);
  const normalizedRightValue = normalizeCompanyNameForComparison(rightValue);

  return (
    !!normalizedLeftValue &&
    !!normalizedRightValue &&
    normalizedLeftValue === normalizedRightValue
  );
}

function getElementRawText(element: Element | null | undefined): string {
  if (!element) {
    return '';
  }

  const htmlElement = element as HTMLElement;

  if (typeof htmlElement.innerText === 'string' && htmlElement.innerText) {
    return htmlElement.innerText;
  }

  return element.textContent || '';
}

function isProfileSectionNoiseLine(line: string): boolean {
  return (
    PROFILE_SECTION_NOISE_PATTERN.test(line) ||
    /^show all \d+/i.test(line) ||
    /^.+ followers$/i.test(line) ||
    /^.+ connections$/i.test(line)
  );
}

function normalizeLinkedInTextLines(lines: string[]): string[] {
  const seenLines = new Set<string>();

  return lines
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !isProfileSectionNoiseLine(line))
    .filter((line) => {
      const normalizedLine = line.toLowerCase();

      if (seenLines.has(normalizedLine)) {
        return false;
      }

      seenLines.add(normalizedLine);
      return true;
    });
}

function getElementTextLines(element: Element | null | undefined): string[] {
  if (!element) {
    return [];
  }

  const rawTextLines = getElementRawText(element).split(/\r?\n/);
  const ariaHiddenLines = Array.from(
    element.querySelectorAll('span[aria-hidden="true"]'),
  ).map((childElement) => childElement.textContent || '');

  return normalizeLinkedInTextLines([...ariaHiddenLines, ...rawTextLines]);
}

function getElementCleanText(element: Element | null | undefined): string {
  return cleanText(getElementRawText(element));
}

function isLinkedInFeedOrPostElement(element: Element): boolean {
  return (
    element.matches(LINKEDIN_FEED_OR_POST_SELECTOR) ||
    element.querySelector(LINKEDIN_FEED_OR_POST_SELECTOR) !== null
  );
}

function hasExactHeading(element: Element, headings: string[]): boolean {
  const normalizedHeadings = new Set(
    headings.map((heading) => heading.toLowerCase()),
  );
  const headingElements = Array.from(
    element.querySelectorAll('h2, .pvs-header__title, .pvs-header__title span'),
  );

  return headingElements.some((headingElement) =>
    getElementTextLines(headingElement).some((line) =>
      normalizedHeadings.has(line.toLowerCase()),
    ),
  );
}

function isExperienceSection(section: Element): boolean {
  if (isLinkedInFeedOrPostElement(section)) {
    return false;
  }

  const experienceAnchor = section.querySelector('#experience');

  if (experienceAnchor?.closest('section') === section) {
    return true;
  }

  return hasExactHeading(section, EXPERIENCE_SECTION_HEADINGS);
}

function getProfileTopCardElement(): Element | null {
  const headingElement =
    document.querySelector('main h1.text-heading-xlarge') ||
    document.querySelector('main .pv-text-details__left-panel h1') ||
    document.querySelector('main .ph5 h1');

  return (
    document.querySelector('.pv-top-card')?.closest('section') ||
    headingElement?.closest('section') ||
    document
      .querySelector('.pv-text-details__left-panel')
      ?.closest('section') ||
    null
  );
}

function isDateRangeLine(line: string): boolean {
  return DATE_RANGE_PATTERN.test(line);
}

function isCurrentDateRangeLine(line: string): boolean {
  return isDateRangeLine(line) && CURRENT_DATE_PATTERN.test(line);
}

function isCompanyMetadataLine(line: string): boolean {
  return (
    EMPLOYMENT_TYPE_PATTERN.test(line) ||
    DURATION_ONLY_PATTERN.test(line) ||
    /^company$/i.test(line)
  );
}

function isCurrentCompanyLabel(value: string): boolean {
  const normalizedValue = normalizeForComparison(value);

  return CURRENT_POSITION_ARIA_LABELS.some((label) =>
    normalizedValue.includes(normalizeForComparison(label)),
  );
}

function removeJobTitlePrefix(value: string, jobTitle?: string): string {
  if (!jobTitle) {
    return value;
  }

  const normalizedValue = value.toLowerCase();
  const normalizedJobTitle = jobTitle.toLowerCase();

  if (!normalizedValue.startsWith(normalizedJobTitle)) {
    return value;
  }

  const remainingValue = value.slice(jobTitle.length);

  if (remainingValue.length <= 2) {
    return value;
  }

  if (!/^[\s.,;:·|•\-–a-z]/.test(remainingValue)) {
    return value;
  }

  return trimPunctuation(remainingValue);
}

function removeCurrentCompanyLabel(candidate: string): string {
  const cleanCandidate = cleanText(candidate);
  const colonIndex = cleanCandidate.indexOf(':');

  if (colonIndex === -1) {
    return cleanCandidate;
  }

  const label = cleanCandidate.slice(0, colonIndex);

  if (!isCurrentCompanyLabel(label)) {
    return cleanCandidate;
  }

  return cleanText(cleanCandidate.slice(colonIndex + 1));
}

function isLikelyCompanyName(candidate: string, jobTitle?: string): boolean {
  const companyName = trimPunctuation(candidate);

  if (!companyName || companyName.length > 120) {
    return false;
  }

  if (jobTitle && areEquivalentCompanyNames(companyName, jobTitle)) {
    return false;
  }

  if (
    COMPANY_NAME_NOISE_PATTERN.test(companyName) ||
    isDateRangeLine(companyName) ||
    DURATION_ONLY_PATTERN.test(companyName) ||
    /^https?:\/\//i.test(companyName) ||
    /(?:^|\s)(followers|connections|mutual connections)(?:\s|$)/i.test(
      companyName,
    )
  ) {
    return false;
  }

  return true;
}

function sanitizeCompanyName(candidate: string, jobTitle?: string): string {
  const withoutDateRange = removeCurrentCompanyLabel(candidate)
    .replace(DATE_RANGE_FROM_HERE_PATTERN, '')
    .replace(/\s*[·|•]\s*.*$/, (match) =>
      EMPLOYMENT_TYPE_PATTERN.test(match) || DURATION_ONLY_PATTERN.test(match)
        ? ''
        : match,
    )
    .replace(
      new RegExp(`\\s+(?:${EMPLOYMENT_TYPE_PATTERN.source}).*$`, 'i'),
      '',
    );

  const companyName = trimPunctuation(
    removeJobTitlePrefix(withoutDateRange, jobTitle),
  );

  return isLikelyCompanyName(companyName, jobTitle) ? companyName : '';
}

function sanitizeJobTitle(candidate: string): string {
  const jobTitle = trimPunctuation(
    cleanText(candidate).replace(DATE_RANGE_FROM_HERE_PATTERN, ''),
  );

  if (
    !jobTitle ||
    jobTitle.length > 120 ||
    isDateRangeLine(jobTitle) ||
    isCompanyMetadataLine(jobTitle)
  ) {
    return '';
  }

  return jobTitle;
}

function normalizeCompanyLinkedInUrl(
  href: string | null | undefined,
): string | undefined {
  const match = href?.match(/\/company\/([^/?]+)/);

  return match ? `https://www.linkedin.com/company/${match[1]}/` : undefined;
}

function getCompanyLinkedInUrlFromElement(
  element: Element | null | undefined,
): string | undefined {
  const companyLink = element?.matches('a[href*="/company/"]')
    ? element
    : element?.querySelector('a[href*="/company/"]');

  return normalizeCompanyLinkedInUrl(companyLink?.getAttribute('href'));
}

function getLinkedInImageAltText(element: Element | null | undefined): string {
  const imageElement = element?.querySelector('img[alt]') as
    | HTMLImageElement
    | null
    | undefined;

  return trimPunctuation(
    cleanText(imageElement?.alt)
      .replace(/\s+(logo|company logo)$/i, '')
      .replace(/^(logo of|logo for)\s+/i, ''),
  );
}

function getCompanyDataFromElement(
  element: Element | null | undefined,
  jobTitle?: string,
): CompanyData | null {
  const companyLink = element?.matches('a[href*="/company/"]')
    ? element
    : element?.querySelector('a[href*="/company/"]');
  const linkedinUrl = normalizeCompanyLinkedInUrl(
    companyLink?.getAttribute('href'),
  );
  const companyNameCandidates = [
    ...(companyLink
      ? getElementTextLines(companyLink).filter(
          (line) => !isDateRangeLine(line) && !isCompanyMetadataLine(line),
        )
      : []),
    getLinkedInImageAltText(companyLink),
    getLinkedInImageAltText(element),
  ];

  for (const companyNameCandidate of companyNameCandidates) {
    const name = sanitizeCompanyName(companyNameCandidate, jobTitle);

    if (name) {
      return {
        name,
        linkedinUrl,
        logoUrl:
          (companyLink?.querySelector('img') as HTMLImageElement | null)?.src ||
          (element?.querySelector('img') as HTMLImageElement | null)?.src ||
          undefined,
      };
    }
  }

  return linkedinUrl ? { name: '', linkedinUrl } : null;
}

function getStringValue(value: unknown): string {
  return typeof value === 'string' ? cleanText(value) : '';
}

function getNamedEntityName(value: unknown): string {
  if (typeof value === 'string') {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    return value.map(getNamedEntityName).find(Boolean) || '';
  }

  if (value && typeof value === 'object' && 'name' in value) {
    return getStringValue((value as { name?: unknown }).name);
  }

  return '';
}

function collectJsonLdObjects(
  value: unknown,
  seenObjects: WeakSet<object> = new WeakSet(),
): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonLdObjects(item, seenObjects));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (seenObjects.has(value)) {
    return [];
  }

  seenObjects.add(value);

  const objectValue = value as Record<string, unknown>;
  const nestedObjects = Object.values(objectValue).flatMap((nestedValue) =>
    collectJsonLdObjects(nestedValue, seenObjects),
  );

  return [objectValue, ...nestedObjects];
}

function getJsonLdTypeNames(objectValue: Record<string, unknown>): string[] {
  const typeValue = objectValue['@type'];

  return Array.isArray(typeValue)
    ? typeValue.filter((type): type is string => typeof type === 'string')
    : typeof typeValue === 'string'
      ? [typeValue]
      : [];
}

function isJsonLdPersonObject(objectValue: Record<string, unknown>): boolean {
  return getJsonLdTypeNames(objectValue).includes('Person');
}

function getOccupationName(value: unknown): string {
  if (typeof value === 'string') {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    return value.map(getOccupationName).find(Boolean) || '';
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const objectValue = value as Record<string, unknown>;

  return (
    getNamedEntityName(objectValue.name) ||
    getOccupationName(objectValue.hasOccupation)
  );
}

function getNamedEntityLinkedInUrl(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeCompanyLinkedInUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map(getNamedEntityLinkedInUrl).find(Boolean);
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const objectValue = value as Record<string, unknown>;
  const linkedInUrl =
    getStringValue(objectValue.url) ||
    getStringValue(objectValue.sameAs) ||
    getNamedEntityLinkedInUrl(objectValue.sameAs);

  return normalizeCompanyLinkedInUrl(linkedInUrl);
}

function sortJsonLdPersonObjects(
  personObjects: Array<Record<string, unknown>>,
  fullName: string,
): Array<Record<string, unknown>> {
  const normalizedFullName = normalizeForComparison(fullName);

  return [...personObjects].sort((leftPersonObject, rightPersonObject) => {
    const scorePersonObject = (personObject: Record<string, unknown>) => {
      const personName = normalizeForComparison(
        getNamedEntityName(personObject.name),
      );

      return (
        (normalizedFullName && personName === normalizedFullName ? 100 : 0) +
        (personObject.worksFor ? 20 : 0) +
        (personObject.jobTitle || personObject.hasOccupation ? 10 : 0)
      );
    };

    return (
      scorePersonObject(rightPersonObject) - scorePersonObject(leftPersonObject)
    );
  });
}

function scrapeCurrentPositionFromJsonLd(
  fullName: string,
): CurrentPositionData | null {
  for (const scriptElement of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const jsonValue = JSON.parse(scriptElement.textContent || 'null');
      const personObjects = sortJsonLdPersonObjects(
        collectJsonLdObjects(jsonValue).filter(isJsonLdPersonObject),
        fullName,
      );

      if (personObjects.length === 0) {
        continue;
      }

      for (const personObject of personObjects) {
        const jobTitle = sanitizeJobTitle(
          getNamedEntityName(personObject.jobTitle) ||
            getOccupationName(personObject.hasOccupation),
        );
        const companyName = sanitizeCompanyName(
          getNamedEntityName(personObject.worksFor),
          jobTitle,
        );
        const companyLinkedInUrl = getNamedEntityLinkedInUrl(
          personObject.worksFor,
        );

        if (jobTitle || companyName) {
          return {
            jobTitle: jobTitle || undefined,
            companyName: companyName || undefined,
            companyLinkedInUrl,
          };
        }
      }
    } catch (error) {
      console.warn('Could not parse LinkedIn profile structured data:', error);
    }
  }

  return null;
}

function parseCurrentPositionFromLines(
  lines: string[],
  companyLinkedInUrl?: string,
  linkedCompanyName?: string,
): CurrentPositionData | null {
  const dateLineIndex = lines.findIndex(isCurrentDateRangeLine);

  if (dateLineIndex < 2) {
    return null;
  }

  let jobTitleCandidate = '';
  let companyCandidate = sanitizeCompanyName(linkedCompanyName || '');
  const linesBeforeDate = lines.slice(0, dateLineIndex);

  if (companyCandidate) {
    jobTitleCandidate =
      [...linesBeforeDate].reverse().find((line) => {
        const jobTitle = sanitizeJobTitle(line);

        return (
          !!jobTitle &&
          !isCompanyMetadataLine(line) &&
          !areEquivalentCompanyNames(jobTitle, companyCandidate)
        );
      }) || '';
  }

  if (
    !companyCandidate &&
    dateLineIndex >= 3 &&
    isCompanyMetadataLine(lines[1])
  ) {
    companyCandidate = lines[0];
    jobTitleCandidate = lines[dateLineIndex - 1];
  } else if (
    !companyCandidate &&
    dateLineIndex >= 3 &&
    isCompanyMetadataLine(lines[dateLineIndex - 2])
  ) {
    companyCandidate = lines[0];
    jobTitleCandidate = lines[dateLineIndex - 1];
  } else if (!companyCandidate && dateLineIndex >= 2) {
    jobTitleCandidate = lines[dateLineIndex - 2];
    companyCandidate = lines[dateLineIndex - 1];
  } else if (!jobTitleCandidate) {
    jobTitleCandidate = lines[0];
  }

  const jobTitle = sanitizeJobTitle(jobTitleCandidate);
  const companyName = sanitizeCompanyName(companyCandidate, jobTitle);

  if (!jobTitle && !companyName) {
    return null;
  }

  return {
    jobTitle: jobTitle || undefined,
    companyName: companyName || undefined,
    companyLinkedInUrl,
  };
}

function getMetaContent(selector: string): string {
  return cleanText(document.querySelector<HTMLMetaElement>(selector)?.content);
}

function getTextFromSelectors(
  selectors: string[],
  root: ParentNode = document,
): string {
  for (const selector of selectors) {
    const elements = Array.from(root.querySelectorAll(selector));

    for (const element of elements) {
      const text = getElementCleanText(element);

      if (text && text.toLowerCase() !== 'linkedin' && text.length <= 160) {
        return text;
      }
    }
  }

  return '';
}

function getProfileTitleParts(): { name: string; headline: string } {
  const titleCandidates = [
    getMetaContent('meta[property="og:title"]'),
    getMetaContent('meta[name="twitter:title"]'),
    cleanText(document.title),
  ];

  for (const titleCandidate of titleCandidates) {
    const title = titleCandidate
      .replace(/\s*\|\s*LinkedIn\s*$/i, '')
      .replace(/\s*-\s*LinkedIn\s*$/i, '')
      .trim();

    if (!title || /^linkedin$/i.test(title)) {
      continue;
    }

    const parts = title
      .split(/\s[-–]\s/)
      .map(cleanText)
      .filter(Boolean);

    if (parts.length > 0) {
      return {
        name: parts[0],
        headline: parts.slice(1).join(' - '),
      };
    }
  }

  return { name: '', headline: '' };
}

function getProfileName(): string {
  const topCardElement = getProfileTopCardElement();
  const selectorName = topCardElement
    ? getTextFromSelectors(PROFILE_NAME_SELECTORS, topCardElement)
    : '';

  if (selectorName) {
    return selectorName;
  }

  return getProfileTitleParts().name;
}

function getProfileHeadline(fullName: string): string {
  const topCardElement = getProfileTopCardElement();
  const selectorHeadline = topCardElement
    ? getTextFromSelectors(PROFILE_HEADLINE_SELECTORS, topCardElement)
    : '';

  if (selectorHeadline && selectorHeadline !== fullName) {
    return selectorHeadline;
  }

  return getProfileTitleParts().headline;
}

// Detect page type from URL
export function getLinkedInPageType(url: string): 'person' | 'company' | null {
  const pageType = url.match(LINKEDIN_PAGE_URL_PATTERN)?.[1]?.toLowerCase();

  return pageType === 'in'
    ? 'person'
    : pageType === 'company'
      ? 'company'
      : null;
}

// Extract LinkedIn profile identifier from URL
export function getLinkedInIdentifier(url: string): string | null {
  return url.match(LINKEDIN_PAGE_URL_PATTERN)?.[2] || null;
}

export function getCanonicalLinkedInPageUrl(url: string): string | null {
  const pageType = getLinkedInPageType(url);
  const identifier = getLinkedInIdentifier(url);

  if (!pageType || !identifier) {
    return null;
  }

  const path = pageType === 'person' ? 'in' : 'company';

  return `https://www.linkedin.com/${path}/${identifier}`;
}

// Scrape person profile data from LinkedIn page
export function scrapePersonProfile(): LinkedInProfileData | null {
  try {
    const linkedinUrl = getCanonicalLinkedInPageUrl(window.location.href);

    const fullName = getProfileName();

    if (!linkedinUrl || !fullName) {
      console.warn('Could not find profile name from DOM or page title');
      return null;
    }

    console.log('Scraped name:', fullName);
    const nameParts = parseFullName(fullName);

    const headline = getProfileHeadline(fullName);
    console.log('Scraped headline:', headline);

    const structuredPosition = scrapeCurrentPositionFromJsonLd(fullName);
    const experiencePosition = scrapeCurrentPositionFromExperience();
    const headlinePosition = extractPositionFromHeadline(headline);
    const jobTitle =
      experiencePosition?.jobTitle ||
      structuredPosition?.jobTitle ||
      headlinePosition.jobTitle ||
      undefined;
    const topCardCompanyData = scrapeCurrentCompanyFromProfile(jobTitle);
    const companyCandidates: Array<CompanyData | null> = [
      topCardCompanyData,
      structuredPosition?.companyName
        ? {
            name: structuredPosition.companyName,
            linkedinUrl: structuredPosition.companyLinkedInUrl,
            logoUrl: structuredPosition.companyLogoUrl,
          }
        : null,
      experiencePosition?.companyName
        ? {
            name: experiencePosition.companyName,
            linkedinUrl: experiencePosition.companyLinkedInUrl,
            logoUrl: experiencePosition.companyLogoUrl,
          }
        : null,
      headlinePosition.companyName
        ? { name: headlinePosition.companyName }
        : null,
    ];
    const scrapedCompanyData = companyCandidates.find((companyCandidate) =>
      sanitizeCompanyName(companyCandidate?.name || '', jobTitle),
    );
    const currentCompany =
      sanitizeCompanyName(scrapedCompanyData?.name || '', jobTitle) ||
      undefined;
    const currentCompanyLinkedInUrl = scrapedCompanyData?.linkedinUrl;

    console.log('Scraped structured position:', structuredPosition);
    console.log('Scraped experience position:', experiencePosition);
    console.log('Scraped headline position:', headlinePosition);
    console.log('Scraped top card company:', topCardCompanyData);
    console.log('Scraped company data:', scrapedCompanyData);
    console.log('Current company:', currentCompany);

    // Get profile image - try to get high quality version
    const profileImageUrl = scrapeProfileImage();

    // Get location - span with location info
    const locationElement =
      document.querySelector(
        'span.text-body-small.inline.t-black--light.break-words',
      ) ||
      document.querySelector(
        '.text-body-small.inline.t-black--light.break-words',
      ) ||
      document.querySelector('.pv-top-card--list-bullet li:last-child');
    const location = getElementCleanText(locationElement);
    console.log('Scraped location:', location);

    const result = {
      type: 'person' as const,
      linkedinUrl,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      headline,
      jobTitle,
      currentCompany,
      currentCompanyLinkedInUrl,
      profileImageUrl: profileImageUrl || undefined,
      location: location || undefined,
    };

    console.log('Scraped profile data:', {
      fullName,
      firstName: result.firstName,
      lastName: result.lastName,
      jobTitle: result.jobTitle,
      headline: result.headline,
    });

    return result;
  } catch (error) {
    console.error('Error scraping person profile:', error);
    return null;
  }
}

// Scrape profile image
function scrapeProfileImage(): string {
  // Try multiple selectors - LinkedIn changes DOM frequently
  const selectors = [
    '.pv-top-card-profile-picture__container img', // New format with button wrapper
    '.pv-top-card-profile-picture__image', // Old format
    'img.profile-photo-edit__preview',
    '.pv-top-card__photo img',
    'button[aria-label*="image"] img', // Button with image label
    '.EntityPhoto-circle-9 img', // Entity photo class
    'img[title]', // Fallback: img with title (usually name)
  ];

  for (const selector of selectors) {
    const img = document.querySelector(selector) as HTMLImageElement;
    if (img?.src && !img.src.includes('ghost') && img.src.includes('profile')) {
      // Use the URL as-is - LinkedIn URLs have signed params that break if modified
      console.log('Scraped profile image:', img.src);
      return img.src;
    }
  }

  return '';
}

function getExperienceSection(): Element | null {
  const experienceAnchor = document.querySelector('main #experience');
  const sectionFromAnchor = experienceAnchor?.closest('section');

  if (sectionFromAnchor && isExperienceSection(sectionFromAnchor)) {
    return sectionFromAnchor;
  }

  return (
    Array.from(document.querySelectorAll('main section')).find(
      isExperienceSection,
    ) || null
  );
}

function getExperienceItemCandidates(section: Element): Element[] {
  const candidateSelectors = [
    'li.artdeco-list__item',
    'li.pvs-list__paged-list-item',
    'div[data-view-name="profile-component-entity"]',
    '.pvs-entity',
  ];
  const candidates = new Set<Element>();

  for (const selector of candidateSelectors) {
    for (const candidate of Array.from(section.querySelectorAll(selector))) {
      candidates.add(candidate);
    }
  }

  return Array.from(candidates).filter((candidate) => {
    if (
      candidate.closest('section') !== section ||
      isLinkedInFeedOrPostElement(candidate)
    ) {
      return false;
    }

    const lines = getElementTextLines(candidate);

    return lines.length >= 2 && lines.some(isCurrentDateRangeLine);
  });
}

function scrapeCurrentPositionFromExperience(): CurrentPositionData | null {
  const experienceSection = getExperienceSection();

  if (!experienceSection) {
    return null;
  }

  const parsedPositions: Array<{
    position: CurrentPositionData;
    isCurrent: boolean;
  }> = getExperienceItemCandidates(experienceSection).flatMap((candidate) => {
    const lines = getElementTextLines(candidate);
    const companyData = getCompanyDataFromElement(candidate);
    const position = parseCurrentPositionFromLines(
      lines,
      companyData?.linkedinUrl || getCompanyLinkedInUrlFromElement(candidate),
      companyData?.name,
    );

    if (!position) {
      return [];
    }

    const logoImg = candidate.querySelector('img');
    const companyLogoUrl = companyData?.logoUrl || logoImg?.src || undefined;

    return [
      {
        position: {
          ...position,
          companyName: position.companyName || companyData?.name,
          companyLogoUrl,
        },
        isCurrent: lines.some(isCurrentDateRangeLine),
      },
    ];
  });

  return (
    parsedPositions.find(
      ({ isCurrent, position }) =>
        isCurrent && position.jobTitle && position.companyName,
    )?.position ||
    parsedPositions.find(({ isCurrent }) => isCurrent)?.position ||
    parsedPositions.find(
      ({ position }) => position.jobTitle && position.companyName,
    )?.position ||
    parsedPositions[0]?.position ||
    null
  );
}

// Scrape company info from current profile top card
function scrapeCurrentCompanyFromProfile(
  jobTitle?: string,
): CompanyData | null {
  try {
    const topCardElement = getProfileTopCardElement();

    if (!topCardElement) {
      return null;
    }

    // Best method: use the explicit current-company accessibility label.
    const companyButton = Array.from(
      topCardElement.querySelectorAll('[aria-label]'),
    ).find((element) => {
      const ariaLabel = element.getAttribute('aria-label') || '';
      const labelPrefix = ariaLabel.split(':')[0] || ariaLabel;

      return isCurrentCompanyLabel(labelPrefix);
    });

    if (companyButton) {
      const ariaLabel = companyButton.getAttribute('aria-label') || '';
      const companyNameCandidate =
        removeCurrentCompanyLabel(ariaLabel).split(/\.\s+/)[0] || ariaLabel;
      const name = sanitizeCompanyName(companyNameCandidate, jobTitle);
      const companyData = getCompanyDataFromElement(
        companyButton.closest('section') || companyButton.parentElement,
        jobTitle,
      );

      if (name) {
        console.log('Found company from current-company label:', {
          name,
          logoUrl: companyData?.logoUrl,
        });

        return {
          name,
          linkedinUrl: companyData?.linkedinUrl,
          logoUrl: companyData?.logoUrl,
        };
      }
    }

    // Fallback: Try to find company link in the top card only.
    const companyLink =
      topCardElement.querySelector(
        '.pv-text-details__right-panel-item-text a[href*="/company/"]',
      ) ||
      topCardElement.querySelector(
        '.pv-text-details__right-panel a[href*="/company/"]',
      ) ||
      topCardElement.querySelector('a[href*="/company/"]');

    if (companyLink) {
      const companyData = getCompanyDataFromElement(companyLink, jobTitle);
      const companyNameLine =
        getElementTextLines(companyLink).find(
          (line) => !isDateRangeLine(line) && !isCompanyMetadataLine(line),
        ) || getElementCleanText(companyLink);

      const name =
        sanitizeCompanyName(companyNameLine, jobTitle) ||
        companyData?.name ||
        '';

      if (name) {
        return {
          name,
          linkedinUrl:
            companyData?.linkedinUrl ||
            normalizeCompanyLinkedInUrl(companyLink.getAttribute('href')),
          logoUrl: companyData?.logoUrl,
        };
      }
    }

    // Last fallback: just get company name without URL
    const companyElement =
      topCardElement.querySelector('.pv-text-details__right-panel-item-text') ||
      Array.from(topCardElement.querySelectorAll('[aria-label]')).find(
        (element) =>
          isCurrentCompanyLabel(element.getAttribute('aria-label') || ''),
      );

    if (companyElement) {
      const name = sanitizeCompanyName(
        getElementCleanText(companyElement),
        jobTitle,
      );

      if (name) {
        return { name };
      }
    }

    return null;
  } catch (error) {
    console.error('Error scraping company from profile:', error);
    return null;
  }
}

function getCompanyDefinitionValue(label: string): string {
  const normalizedLabel = normalizeForComparison(label);
  const termElement = Array.from(document.querySelectorAll('main dt')).find(
    (element) =>
      normalizeForComparison(getElementCleanText(element)) === normalizedLabel,
  );

  return getElementCleanText(termElement?.nextElementSibling);
}

function getCompanyName(): string {
  const nameElement =
    document.querySelector('h1.org-top-card-summary__title') ||
    document.querySelector('main h1.top-card-layout__title') ||
    document.querySelector('main h1');
  const name = getElementCleanText(nameElement);

  if (name) {
    return name;
  }

  return getMetaContent('meta[property="og:title"]').replace(
    /\s*[|–-]\s*LinkedIn$/,
    '',
  );
}

function getCompanyWebsite(): string {
  const websiteElement =
    document.querySelector('a[data-control-name="top_card_link_website"]') ||
    document.querySelector('a[href*="trk=about_website"]') ||
    document.querySelector(
      '.link-without-visited-state.org-top-card-primary-actions__action',
    );

  if (!websiteElement) {
    return '';
  }

  const websiteFromText =
    getElementCleanText(websiteElement).match(/https?:\/\/[^\s]+/i)?.[0];

  if (websiteFromText) {
    return websiteFromText;
  }

  const href = websiteElement.getAttribute('href');

  if (!href) {
    return '';
  }

  try {
    const websiteUrl = new URL(href, window.location.href);

    if (
      websiteUrl.hostname.endsWith('linkedin.com') &&
      websiteUrl.pathname.includes('/redir/redirect')
    ) {
      return websiteUrl.searchParams.get('url') || '';
    }

    return websiteUrl.hostname.endsWith('linkedin.com')
      ? ''
      : websiteUrl.toString();
  } catch {
    return '';
  }
}

function getCompanyEmployeeCount(): string {
  const exactEmployeeCountElement = document.querySelector(
    'main a[href*="facetCurrentCompany"]',
  );
  const exactEmployeeCount = getElementCleanText(
    exactEmployeeCountElement,
  ).match(/[\d,.]+\s+employees?/i)?.[0];

  if (exactEmployeeCount) {
    return exactEmployeeCount;
  }

  const summaryEmployeeCount = Array.from(
    document.querySelectorAll('.org-top-card-summary-info-list__info-item'),
  )
    .map((element) => getElementCleanText(element))
    .find((value) => /\bemployees?\b/i.test(value));

  return (
    summaryEmployeeCount ||
    getCompanyDefinitionValue('Company size').match(
      /[\d,.]+\s*[-–]\s*[\d,.]+\s+employees?/i,
    )?.[0] ||
    ''
  );
}

// Scrape company page data from LinkedIn
export function scrapeCompanyPage(): LinkedInCompanyData | null {
  try {
    const linkedinUrl = getCanonicalLinkedInPageUrl(window.location.href);
    const name = getCompanyName();

    if (!linkedinUrl || !name) {
      console.warn('Could not find company name or LinkedIn URL');
      return null;
    }

    const industry =
      getElementCleanText(
        document.querySelector('.org-top-card-summary-info-list__info-item'),
      ) ||
      getElementCleanText(
        document.querySelector('main h2.top-card-layout__headline'),
      ) ||
      getCompanyDefinitionValue('Industry');
    const employeeCount = getCompanyEmployeeCount();
    const website = getCompanyWebsite();
    const logoElement =
      document.querySelector('.org-top-card-primary-content__logo') ||
      document.querySelector('main img.top-card-layout__entity-image');
    const logoUrl =
      logoElement?.getAttribute('src') ||
      logoElement?.getAttribute('data-delayed-url') ||
      getMetaContent('meta[property="og:image"]');
    const description =
      getElementCleanText(
        document.querySelector('.org-top-card-summary__tagline'),
      ) ||
      getElementCleanText(
        document.querySelector('main .top-card-layout__second-subline'),
      ) ||
      getMetaContent('meta[property="og:description"]');

    return {
      type: 'company',
      linkedinUrl,
      name,
      website: website || undefined,
      industry: industry || undefined,
      employeeCount: employeeCount || undefined,
      logoUrl: logoUrl || undefined,
      description: description || undefined,
    };
  } catch (error) {
    console.error('Error scraping company page:', error);
    return null;
  }
}

// Main scraper function that detects page type and scrapes accordingly
export function scrapeCurrentPage(): LinkedInData | null {
  const pageType = getLinkedInPageType(window.location.href);

  if (pageType === 'person') {
    return scrapePersonProfile();
  }

  if (pageType === 'company') {
    return scrapeCompanyPage();
  }

  return null;
}

// Helper to parse full name into first and last name
function parseFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  // Handle cases like "John van der Berg" - take first as firstName, rest as lastName
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');

  return { firstName, lastName };
}

// Try to extract role and company from headlines like "Software Engineer at Google".
function extractPositionFromHeadline(headline: string): CurrentPositionData {
  const patterns = [
    /^(.+?)\s+\bat\s+(.+?)(?:\s*[|•]|$)/i, // English: "Role at Company"
    /^(.+?)\s+\bchez\s+(.+?)(?:\s*[|•]|$)/i, // French: "Role chez Company"
    /^(.+?)\s+\bbei\s+(.+?)(?:\s*[|•]|$)/i, // German: "Role bei Company"
    /^(.+?)\s+\bfor\s+(.+?)(?:\s*[|•]|$)/i, // English: "Role for Company"
    /^(.+?)\s+\bà\s+(.+?)(?:\s*[|•]|$)/i, // French: "Role à Company"
    /^(.+?)\s+\ben\s+(.+?)(?:\s*[|•]|$)/i, // Spanish: "Role en Company"
    /^(.+?)\s+@\s*(.+?)(?:\s*[|•]|$)/i, // Symbol: "Role @ Company"
  ];

  for (const pattern of patterns) {
    const match = headline.match(pattern);

    if (match) {
      const jobTitle = sanitizeJobTitle(match[1]);
      const companyName = sanitizeCompanyName(match[2], jobTitle);

      console.log('Extracted position from headline:', {
        jobTitle,
        companyName,
        pattern,
      });

      return {
        jobTitle: jobTitle || undefined,
        companyName: companyName || undefined,
      };
    }
  }

  return {};
}
