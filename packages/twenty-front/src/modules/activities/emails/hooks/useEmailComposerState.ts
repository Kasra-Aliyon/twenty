import { useCallback, useMemo, useState } from 'react';
import { MAX_EMAIL_RECIPIENTS } from 'twenty-shared/constants';
import { type EmailAttachment } from 'twenty-shared/types';

import { useSendEmail } from '@/activities/emails/hooks/useSendEmail';

type UseEmailComposerStateArgs = {
  connectedAccountId: string;
  defaultTo?: string;
  defaultCc?: string;
  defaultBcc?: string;
  defaultSubject?: string;
  defaultBody?: string;
  defaultInReplyTo?: string;
  onSent?: () => void | Promise<void>;
};

const countRecipients = (csv: string): number =>
  csv
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;

const normalizeComposerText = (value: string | null | undefined): string =>
  value ?? '';

export const useEmailComposerState = ({
  connectedAccountId: initialConnectedAccountId,
  defaultTo = '',
  defaultCc = '',
  defaultBcc = '',
  defaultSubject = '',
  defaultBody = '',
  defaultInReplyTo,
  onSent,
}: UseEmailComposerStateArgs) => {
  const normalizedDefaultTo = normalizeComposerText(defaultTo);
  const normalizedDefaultCc = normalizeComposerText(defaultCc);
  const normalizedDefaultBcc = normalizeComposerText(defaultBcc);
  const normalizedDefaultSubject = normalizeComposerText(defaultSubject);
  const normalizedDefaultBody = normalizeComposerText(defaultBody);
  const [connectedAccountId, setConnectedAccountId] = useState(
    initialConnectedAccountId,
  );
  const [to, setToState] = useState(normalizedDefaultTo);
  const [cc, setCcState] = useState(normalizedDefaultCc);
  const [bcc, setBccState] = useState(normalizedDefaultBcc);
  const [subject, setSubjectState] = useState(normalizedDefaultSubject);
  const [body, setBodyState] = useState(normalizedDefaultBody);
  const [showCcBcc, setShowCcBcc] = useState(
    normalizedDefaultCc.length > 0 || normalizedDefaultBcc.length > 0,
  );
  const [files, setFiles] = useState<EmailAttachment[]>([]);

  const { sendEmail, loading } = useSendEmail();
  const setTo = (value: string | null | undefined) =>
    setToState(normalizeComposerText(value));
  const setCc = (value: string | null | undefined) =>
    setCcState(normalizeComposerText(value));
  const setBcc = (value: string | null | undefined) =>
    setBccState(normalizeComposerText(value));
  const setSubject = (value: string | null | undefined) =>
    setSubjectState(normalizeComposerText(value));
  const setBody = (value: string | null | undefined) =>
    setBodyState(normalizeComposerText(value));

  const recipientCount = useMemo(
    () => countRecipients(to) + countRecipients(cc) + countRecipients(bcc),
    [to, cc, bcc],
  );

  const exceedsRecipientLimit = recipientCount > MAX_EMAIL_RECIPIENTS;

  const canSend =
    to.trim().length > 0 &&
    connectedAccountId.length > 0 &&
    !loading &&
    !exceedsRecipientLimit;

  const handleSend = useCallback(async () => {
    if (!to.trim() || !connectedAccountId || exceedsRecipientLimit) {
      return;
    }

    const trimmedTo = to.trim();
    const trimmedCc = cc.trim();
    const trimmedBcc = bcc.trim();

    const success = await sendEmail({
      connectedAccountId,
      to: trimmedTo,
      cc: trimmedCc || undefined,
      bcc: trimmedBcc || undefined,
      subject,
      body,
      inReplyTo: defaultInReplyTo,
      files: files.length > 0 ? files : undefined,
    });

    if (success) {
      await onSent?.();
    }
  }, [
    connectedAccountId,
    to,
    cc,
    bcc,
    subject,
    body,
    defaultInReplyTo,
    files,
    sendEmail,
    onSent,
    exceedsRecipientLimit,
  ]);

  return {
    connectedAccountId,
    setConnectedAccountId,
    to,
    setTo,
    cc,
    setCc,
    bcc,
    setBcc,
    subject,
    setSubject,
    body,
    setBody,
    showCcBcc,
    setShowCcBcc,
    files,
    setFiles,
    handleSend,
    loading,
    canSend,
    defaultTo: normalizedDefaultTo,
    defaultCc: normalizedDefaultCc,
    defaultBcc: normalizedDefaultBcc,
    defaultSubject: normalizedDefaultSubject,
    defaultBody: normalizedDefaultBody,
    recipientCount,
    exceedsRecipientLimit,
    maxRecipients: MAX_EMAIL_RECIPIENTS,
  };
};
