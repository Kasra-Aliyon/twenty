import type {
  LinkedInHarvestConnection,
  LinkedInHarvestInvitation,
  LinkedInSyncProgress,
} from '../types';
import {
  writeLinkedInConnections,
  writeLinkedInInvitations,
} from './linkedin-harvest-store';
import {
  getLinkedInSyncState,
  LINKEDIN_INVITATION_SYNC_REVISION,
  updateLinkedInSyncState,
} from './linkedin-sync-state';
import { linkedInVoyagerClient, randomDelay } from './linkedin-voyager-client';

const CONNECTION_PAGE_SIZE = 500;
const CONNECTION_ALREADY_KNOWN_THRESHOLD = 50;
const INVITATION_PAGE_SIZE = 100;
const INVITATION_ALREADY_KNOWN_THRESHOLD = 10;
const LINKEDIN_ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

type VoyagerPage = Awaited<
  ReturnType<typeof linkedInVoyagerClient.fetchConnectionsPage>
>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

const getValue = (value: unknown, path: string[]): unknown => {
  let current: unknown = value;

  for (const key of path) {
    current = asRecord(current)?.[key];
  }

  return current;
};

const getString = (value: unknown, path: string[]): string | null => {
  const candidate = getValue(value, path);

  return typeof candidate === 'string' ? candidate : null;
};

const getNumber = (value: unknown, path: string[]): number | null => {
  const candidate = getValue(value, path);

  return typeof candidate === 'number' ? candidate : null;
};

const toIsoDate = (timestamp: number | null): string | null =>
  timestamp === null ? null : new Date(timestamp).toISOString();

const getLinkedInIdFromProfileUrn = (profileUrn: string): string | null => {
  const encodedPart = profileUrn
    .replace('urn:li:fs_miniProfile:', '')
    .replace('urn:li:fsd_profile:', '')
    .slice(5, 12);

  if (encodedPart.length === 0) {
    return null;
  }

  let decodedValue = 0n;

  for (const character of encodedPart) {
    const index = LINKEDIN_ID_ALPHABET.indexOf(character);

    if (index === -1) {
      return null;
    }

    decodedValue = (decodedValue << 6n) + BigInt(index);
  }

  return (decodedValue >> 8n).toString();
};

const normalizeHandle = (value: string): string => {
  try {
    const url = new URL(
      value.startsWith('http') ? value : `https://www.linkedin.com/in/${value}`,
    );

    return decodeURIComponent(
      url.pathname.match(/^\/in\/([^/]+)/)?.[1] ?? value,
    );
  } catch {
    return decodeURIComponent(value);
  }
};

const parseConnections = (page: VoyagerPage): LinkedInHarvestConnection[] => {
  const profiles = page.included.filter(
    (item) =>
      getString(item, ['$type']) ===
      'com.linkedin.voyager.dash.identity.profile.Profile',
  );
  const relationships = page.included.filter(
    (item) =>
      getString(item, ['$type']) ===
      'com.linkedin.voyager.dash.relationships.Connection',
  );
  const relationshipsByMember = new Map<string, unknown>();

  for (const relationship of relationships) {
    const connectedMember = getString(relationship, ['connectedMember']);

    if (connectedMember) {
      relationshipsByMember.set(connectedMember, relationship);
    }
  }

  return profiles
    .map((profile): LinkedInHarvestConnection | null => {
      const entityUrn = getString(profile, ['entityUrn']);
      const publicIdentifier = getString(profile, ['publicIdentifier']);

      if (!entityUrn || !publicIdentifier) {
        return null;
      }

      const relationship = relationshipsByMember.get(entityUrn);
      const profileUrn = entityUrn.replace('urn:li:fsd_profile:', '');
      const handle = normalizeHandle(publicIdentifier);
      const firstName = getString(profile, ['firstName']) ?? '';
      const lastName = getString(profile, ['lastName']) ?? '';

      return {
        profileUrn,
        linkedinId: getLinkedInIdFromProfileUrn(profileUrn),
        handle,
        name: `${firstName} ${lastName}`.trim() || handle,
        headline: getString(profile, ['headline']),
        profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(handle)}/`,
        connectedAt: toIsoDate(getNumber(relationship, ['createdAt'])),
      };
    })
    .filter((record): record is LinkedInHarvestConnection => record !== null)
    .sort(
      (first, second) =>
        new Date(second.connectedAt ?? 0).getTime() -
        new Date(first.connectedAt ?? 0).getTime(),
    );
};

export const parseInvitationSentAt = (label: string | null): string | null => {
  if (!label) {
    return null;
  }

  const normalizedLabel = label.trim().toLowerCase();
  const date = new Date();

  date.setHours(0, 0, 0, 0);

  if (normalizedLabel === 'sent today') {
    return date.toISOString();
  }

  if (normalizedLabel === 'sent yesterday') {
    date.setDate(date.getDate() - 1);
    return date.toISOString();
  }

  const patterns = [
    {
      pattern: /^sent (\d+) days? ago$/,
      subtract: (amount: number) => date.setDate(date.getDate() - amount),
    },
    {
      pattern: /^sent (\d+) weeks? ago$/,
      subtract: (amount: number) => date.setDate(date.getDate() - amount * 7),
    },
    {
      pattern: /^sent (\d+) months? ago$/,
      subtract: (amount: number) => date.setMonth(date.getMonth() - amount),
    },
  ];

  for (const { pattern, subtract } of patterns) {
    const match = normalizedLabel.match(pattern);

    if (match?.[1]) {
      subtract(Number.parseInt(match[1], 10));
      return date.toISOString();
    }
  }

  console.warn(`[Twenty] Could not parse invitation date label: ${label}`);
  return null;
};

const parseInvitationCards = (
  elements: unknown[],
  direction: 'SENT' | 'RECEIVED',
): LinkedInHarvestInvitation[] =>
  elements
    .map((element): LinkedInHarvestInvitation | null => {
      const cardActionTarget = getString(element, ['cardActionTarget']);
      const invitation = getValue(element, ['invitation']);
      const member =
        getValue(invitation, ['inviteeMemberResolutionResult']) ??
        getValue(invitation, ['inviterMemberResolutionResult']) ??
        getValue(element, ['inviterMemberResolutionResult']);
      const entityUrn = getString(member, ['entityUrn']);
      const profileUrn = entityUrn?.replace('urn:li:fsd_profile:', '');
      const rawHandle =
        cardActionTarget ??
        getString(member, ['publicIdentifier']) ??
        profileUrn;

      if (!rawHandle) {
        return null;
      }

      const handle = normalizeHandle(rawHandle);
      const firstName = getString(member, ['firstName']) ?? '';
      const lastName = getString(member, ['lastName']) ?? '';

      return {
        profileUrn: profileUrn ?? handle,
        linkedinId: getLinkedInIdFromProfileUrn(profileUrn ?? handle),
        direction,
        handle,
        name: `${firstName} ${lastName}`.trim() || handle,
        headline:
          getString(element, ['subtitle', 'text']) ??
          getString(member, ['headline', 'text']) ??
          getString(member, ['headline']),
        message: getString(invitation, ['message']),
        sentAt: parseInvitationSentAt(
          getString(element, ['sentTimeLabel']) ??
            getString(element, ['timeLabel']),
        ),
      };
    })
    .filter((record): record is LinkedInHarvestInvitation => record !== null)
    .sort(
      (first, second) =>
        new Date(second.sentAt ?? 0).getTime() -
        new Date(first.sentAt ?? 0).getTime(),
    );

const parseInvitationEntities = (
  included: unknown[],
  direction: 'SENT' | 'RECEIVED',
): LinkedInHarvestInvitation[] => {
  const profilesByUrn = new Map<string, unknown>();

  for (const entity of included) {
    const entityUrn = getString(entity, ['entityUrn']);

    if (entityUrn) {
      profilesByUrn.set(entityUrn, entity);
    }
  }

  return included
    .filter((entity) => getString(entity, ['$type'])?.endsWith('.Invitation'))
    .map((invitation): LinkedInHarvestInvitation | null => {
      const memberReference =
        getString(invitation, [
          direction === 'SENT' ? '*toMember' : '*fromMember',
        ]) ?? getString(invitation, ['invitee', '*miniProfile']);
      const member = memberReference
        ? profilesByUrn.get(memberReference)
        : null;
      const entityUrn = getString(member, ['entityUrn']) ?? memberReference;

      if (!entityUrn) {
        return null;
      }

      const profileUrn = entityUrn
        .replace('urn:li:fs_miniProfile:', '')
        .replace('urn:li:fsd_profile:', '');
      const handle = getString(member, ['publicIdentifier']) ?? profileUrn;
      const firstName = getString(member, ['firstName']) ?? '';
      const lastName = getString(member, ['lastName']) ?? '';
      const sentTime = getNumber(invitation, ['sentTime']);

      return {
        profileUrn,
        linkedinId: getLinkedInIdFromProfileUrn(profileUrn),
        direction,
        handle: normalizeHandle(handle),
        name: `${firstName} ${lastName}`.trim() || handle,
        headline:
          getString(member, ['occupation']) ??
          getString(member, ['headline']) ??
          getString(member, ['headline', 'text']),
        message:
          getString(invitation, ['message']) ??
          getString(invitation, ['invitationMessage', 'body']),
        sentAt: sentTime === null ? null : new Date(sentTime).toISOString(),
      };
    })
    .filter((record): record is LinkedInHarvestInvitation => record !== null);
};

const parseInvitations = (
  page: VoyagerPage,
  direction: 'SENT' | 'RECEIVED',
): LinkedInHarvestInvitation[] => {
  const records = [
    ...parseInvitationCards(page.elements, direction),
    ...parseInvitationEntities(page.included, direction),
  ];
  const recordsByProfile = new Map<string, LinkedInHarvestInvitation>();

  for (const record of records) {
    recordsByProfile.set(record.profileUrn, record);
  }

  return [...recordsByProfile.values()].sort(
    (first, second) =>
      new Date(second.sentAt ?? 0).getTime() -
      new Date(first.sentAt ?? 0).getTime(),
  );
};

const parseReceivedInvitationsFromDom = (): LinkedInHarvestInvitation[] => {
  if (
    !window.location.pathname.startsWith('/mynetwork/invitation-manager') ||
    window.location.pathname.includes('/sent')
  ) {
    return [];
  }

  const invitations = new Map<string, LinkedInHarvestInvitation>();
  const acceptButtons = document.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="Accept "]',
  );

  for (const button of acceptButtons) {
    const label = button.getAttribute('aria-label') ?? '';

    if (!/[’']s invitation$/i.test(label)) {
      continue;
    }

    let card: HTMLElement | null = button.parentElement;

    while (
      card &&
      (!card.textContent?.includes('wants to connect') ||
        !card.querySelector<HTMLAnchorElement>('a[href*="/in/"]'))
    ) {
      card = card.parentElement;
    }

    const profileLink =
      card?.querySelector<HTMLAnchorElement>('a[href*="/in/"]');

    if (!card || !profileLink) {
      continue;
    }

    const handle = normalizeHandle(profileLink.href);
    const name = label
      .replace(/^Accept /i, '')
      .replace(/[’']s invitation$/i, '')
      .trim();
    let detailsCard = card;
    let messageLink = detailsCard.querySelector<HTMLAnchorElement>(
      'a[href*="/messaging/compose/"]',
    );

    for (
      let depth = 0;
      !messageLink && detailsCard.parentElement && depth < 4;
      depth += 1
    ) {
      const parent = detailsCard.parentElement;

      if (parent.querySelectorAll('button[aria-label^="Accept "]').length > 1) {
        break;
      }

      detailsCard = parent;
      messageLink = detailsCard.querySelector<HTMLAnchorElement>(
        'a[href*="/messaging/compose/"]',
      );
    }
    const messageUrl = messageLink
      ? new URL(messageLink.href, window.location.origin)
      : null;
    const profileUrn =
      messageUrl?.searchParams
        .get('profileUrn')
        ?.replace('urn:li:fsd_profile:', '') ??
      messageUrl?.searchParams.get('recipient') ??
      handle;
    const paragraphTexts = [...card.querySelectorAll('p')]
      .map((paragraph) => paragraph.textContent?.trim() ?? '')
      .filter(Boolean);
    const headline =
      paragraphTexts.find(
        (text) =>
          text !== name &&
          !text.includes('wants to connect') &&
          !/mutual connections?/i.test(text) &&
          !/^reply to /i.test(text),
      ) ?? null;
    const message = [...detailsCard.querySelectorAll('p')]
      .map((paragraph) => paragraph.textContent?.trim() ?? '')
      .find(
        (text) =>
          text.length > 10 &&
          !paragraphTexts.includes(text) &&
          !/^reply to |^send a message|^message$/i.test(text),
      );

    invitations.set(handle, {
      profileUrn,
      linkedinId: getLinkedInIdFromProfileUrn(profileUrn),
      direction: 'RECEIVED',
      handle,
      name: name || handle,
      headline,
      message: message ?? null,
      sentAt: null,
    });
  }

  return [...invitations.values()];
};

const syncConnections = async (
  ownerLinkedinId: string,
  runStartedAt: number,
  progress: LinkedInSyncProgress,
): Promise<void> => {
  let start = 0;

  for (;;) {
    const page = await linkedInVoyagerClient.fetchConnectionsPage(
      start,
      CONNECTION_PAGE_SIZE,
    );
    const records = parseConnections(page);

    if (records.length === 0) {
      break;
    }

    progress.connections += records.length;
    const result = await writeLinkedInConnections(
      ownerLinkedinId,
      records,
      runStartedAt,
    );

    if (
      !page.hasMore ||
      result.alreadyKnown >= CONNECTION_ALREADY_KNOWN_THRESHOLD ||
      !page.nextStart ||
      page.nextStart <= start
    ) {
      break;
    }

    start = page.nextStart;
    await randomDelay(500, 5_000);
  }
};

const syncInvitationDirection = async (
  ownerLinkedinId: string,
  direction: 'SENT' | 'RECEIVED',
  runStartedAt: number,
  progress: LinkedInSyncProgress,
  forceFullScan = false,
): Promise<string | null> => {
  let start = 0;

  for (;;) {
    const page =
      direction === 'SENT'
        ? await linkedInVoyagerClient.fetchSentInvitationsPage(
            start,
            INVITATION_PAGE_SIZE,
          )
        : await linkedInVoyagerClient.fetchReceivedInvitationsPage(
            start,
            INVITATION_PAGE_SIZE,
          );

    if (!page) {
      const domRecords = parseReceivedInvitationsFromDom();

      if (domRecords.length > 0) {
        progress.invitations += domRecords.length;
        await writeLinkedInInvitations(
          ownerLinkedinId,
          domRecords,
          runStartedAt,
        );
      }

      return domRecords.length === 0 && direction === 'RECEIVED'
        ? 'Open LinkedIn’s received invitations page to include received connection requests.'
        : null;
    }

    const records = parseInvitations(page, direction);

    if (records.length === 0) {
      break;
    }

    progress.invitations += records.length;
    const result = await writeLinkedInInvitations(
      ownerLinkedinId,
      records,
      runStartedAt,
    );

    if (
      !page.hasMore ||
      (!forceFullScan &&
        result.alreadyKnown >= INVITATION_ALREADY_KNOWN_THRESHOLD) ||
      !page.nextStart ||
      page.nextStart <= start
    ) {
      break;
    }

    start = page.nextStart;
    await randomDelay(500, 5_000);
  }

  return null;
};

export const syncLinkedInConnectionsAndInvitations = async (
  ownerLinkedinId: string,
  runStartedAt: number,
  progress: LinkedInSyncProgress,
): Promise<{ warnings: string[] }> => {
  const warnings: string[] = [];
  const state = await getLinkedInSyncState(ownerLinkedinId);
  const forceFullInvitationScan =
    state.invitationSyncRevision !== LINKEDIN_INVITATION_SYNC_REVISION;
  let invitationSyncSucceeded = true;

  await syncConnections(ownerLinkedinId, runStartedAt, progress);

  for (const direction of ['SENT'] as const) {
    try {
      const warning = await syncInvitationDirection(
        ownerLinkedinId,
        direction,
        runStartedAt,
        progress,
        forceFullInvitationScan,
      );

      if (warning) {
        warnings.push(warning);
      }
    } catch (error) {
      invitationSyncSucceeded = false;
      warnings.push(
        error instanceof Error
          ? error.message
          : `Could not sync ${direction.toLowerCase()} LinkedIn invitations`,
      );
    }
  }

  if (invitationSyncSucceeded && forceFullInvitationScan) {
    await updateLinkedInSyncState(ownerLinkedinId, {
      invitationSyncRevision: LINKEDIN_INVITATION_SYNC_REVISION,
    });
  }

  return { warnings };
};
