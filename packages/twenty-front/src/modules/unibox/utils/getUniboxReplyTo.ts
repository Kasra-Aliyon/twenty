type ReplyMessage = {
  sender: {
    handle: string;
    workspaceMember?: { id: string } | null;
  };
};

const normalizeHandle = (handle: string | null | undefined) =>
  handle?.trim().toLowerCase() ?? '';

export const getUniboxReplyTo = ({
  messages,
  connectedAccountHandle,
  fallbackHandle,
}: {
  messages: ReplyMessage[];
  connectedAccountHandle: string | null;
  fallbackHandle: string;
}): string => {
  const normalizedConnectedAccountHandle = normalizeHandle(
    connectedAccountHandle,
  );
  const lastExternalSender = messages.findLast(({ sender }) => {
    const normalizedSenderHandle = normalizeHandle(sender.handle);

    return (
      normalizedSenderHandle.length > 0 &&
      !sender.workspaceMember?.id &&
      normalizedSenderHandle !== normalizedConnectedAccountHandle
    );
  });

  return lastExternalSender?.sender.handle ?? fallbackHandle;
};
