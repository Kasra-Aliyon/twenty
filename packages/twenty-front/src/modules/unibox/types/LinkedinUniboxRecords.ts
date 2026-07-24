import { type LinksMetadata } from 'twenty-shared/types';

export type LinkedinUniboxMessage = {
  __typename: 'LinkedinMessage';
  id: string;
  body: string;
  deliveredAt: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderName: string;
  senderLinkedinUrn: string | null;
  threadId: string;
};

export type LinkedinUniboxConnection = {
  __typename: 'LinkedinConnection';
  id: string;
  name: string;
  handle: string;
  headline: string | null;
  connectedAt: string | null;
  profileUrl: LinksMetadata | null;
  personId: string | null;
};

export type LinkedinUniboxInvitation = {
  __typename: 'LinkedinInvitation';
  id: string;
  name: string;
  direction: 'SENT' | 'RECEIVED';
  handle: string;
  headline: string | null;
  message: string | null;
  sentAt: string | null;
};

export type LinkedinUniboxParticipant = {
  __typename: 'LinkedinThreadParticipant';
  id: string;
  name: string;
  headline: string | null;
  handle: string | null;
  linkedinUrn: string | null;
  profileUrl: LinksMetadata | null;
  personId: string | null;
  threadId: string;
};

export type LinkedinUniboxDataset =
  | 'CONNECTIONS'
  | 'INVITATIONS'
  | 'MESSAGE_THREADS'
  | 'MESSAGES';
