import { describe, expect, it } from 'vitest';

import type { LinkedInIdentity } from '../../types';
import { linkedinSyncMessagesTesting } from '../linkedin-sync-messages';

const identity: LinkedInIdentity = {
  linkedinId: '123',
  linkedinUrn: 'ACoOwner',
  handle: 'owner',
  name: 'Owner User',
};

const participant = ({
  linkedinId,
  linkedinUrn,
  name,
}: {
  linkedinId: string;
  linkedinUrn: string;
  name: string;
}) => {
  const [firstName, lastName = ''] = name.split(' ');

  return {
    entityUrn: `urn:li:member:${linkedinId}`,
    backendUrn: `urn:li:member:${linkedinId}`,
    hostIdentityUrn: `urn:li:fsd_profile:${linkedinUrn}`,
    participantType: {
      member: { firstName, lastName, publicIdentifier: name.toLowerCase() },
    },
  };
};

const thread = (conversationParticipants: unknown[]) => ({
  backendUrn: 'urn:li:messagingThread:thread-1',
  createdAt: Date.parse('2026-08-14T09:00:00.000Z'),
  lastActivityAt: Date.parse('2026-08-14T10:00:00.000Z'),
  conversationParticipants,
  receipts: [
    {
      fromEntity: 'urn:li:fsd_profile:ACoOwner',
      fromParticipant: { string: 'urn:li:member:123' },
      seenReceipt: {
        eventUrn: 'urn:li:fs_event:(thread-1,message-1)',
        seenAt: String(Date.parse('2026-08-14T10:01:00.000Z')),
      },
    },
    {
      fromEntity: 'urn:li:fsd_profile:ACoRecipient',
      fromParticipant: { string: 'urn:li:member:456' },
      seenReceipt: {
        eventUrn: 'urn:li:fs_event:(thread-1,message-2)',
        seenAt: String(Date.parse('2026-08-14T10:02:00.000Z')),
      },
    },
  ],
});

describe('LinkedIn read receipt parsing', () => {
  it('captures the non-self receipt for a one-to-one conversation', () => {
    const result = linkedinSyncMessagesTesting.toReadReceipts(
      thread([
        participant({
          linkedinId: '123',
          linkedinUrn: 'ACoOwner',
          name: 'Owner User',
        }),
        participant({
          linkedinId: '456',
          linkedinUrn: 'ACoRecipient',
          name: 'Recipient User',
        }),
      ]),
      identity,
    );

    expect(result).toEqual([
      {
        sourceThreadId: 'thread-1',
        readThroughMessageId: 'message-2',
        recipientReadAt: '2026-08-14T10:02:00.000Z',
      },
    ]);
  });

  it('does not flatten group receipts into a misleading recipient status', () => {
    const result = linkedinSyncMessagesTesting.toReadReceipts(
      thread([
        participant({
          linkedinId: '123',
          linkedinUrn: 'ACoOwner',
          name: 'Owner User',
        }),
        participant({
          linkedinId: '456',
          linkedinUrn: 'ACoRecipient',
          name: 'Recipient User',
        }),
        participant({
          linkedinId: '789',
          linkedinUrn: 'ACoSecondRecipient',
          name: 'Second Recipient',
        }),
      ]),
      identity,
    );

    expect(result).toEqual([]);
  });
});
