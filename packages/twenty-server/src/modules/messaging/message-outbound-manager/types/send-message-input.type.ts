type EmailAddress = string | string[];

export type SendMessageInput = {
  body: string;
  subject: string;
  to: EmailAddress;
  cc?: EmailAddress;
  bcc?: EmailAddress;
  html: string;
  isPlainTextOnly?: boolean;
  attachments?: {
    filename: string;
    content: Buffer;
    contentType: string;
  }[];
  inReplyTo?: string;
  threadExternalId?: string;
  references?: string[];
};
