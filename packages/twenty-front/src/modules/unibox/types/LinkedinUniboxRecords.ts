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
