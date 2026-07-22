import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export type MessageDraftRecord = ObjectRecord & {
  id: string;
  subject: string;
  body: string;
  to: string;
  cc: string;
  bcc: string;
  inReplyTo: string | null;
  connectedAccountId: string;
  messageThreadId: string | null;
  authorId: string;
  lastEditedAt: string;
};

export type MessageDraftValues = Pick<
  MessageDraftRecord,
  | 'subject'
  | 'body'
  | 'to'
  | 'cc'
  | 'bcc'
  | 'inReplyTo'
  | 'connectedAccountId'
  | 'messageThreadId'
>;
