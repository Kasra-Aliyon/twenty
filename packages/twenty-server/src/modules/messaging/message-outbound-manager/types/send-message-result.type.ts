export type SendMessageResult = {
  headerMessageId: string;
  sentAt?: string;
  messageExternalId?: string;
  threadExternalId?: string;
  deliveredRecipients?: { to: string[]; cc: string[]; bcc: string[] };
};
