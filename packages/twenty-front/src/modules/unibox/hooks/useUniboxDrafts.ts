import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type MessageDraftRecord } from '@/unibox/types/MessageDraftRecord';

const MESSAGE_DRAFT_LIST_FIELDS = {
  id: true,
  subject: true,
  body: true,
  to: true,
  cc: true,
  bcc: true,
  inReplyTo: true,
  connectedAccountId: true,
  messageThreadId: true,
  authorId: true,
  lastEditedAt: true,
};

// This hook must only be mounted below the messageDraft metadata gate.
export const useUniboxDrafts = ({
  authorId,
  messageThreadId,
}: {
  authorId: string;
  messageThreadId?: string;
}) =>
  useFindManyRecords<MessageDraftRecord>({
    objectNameSingular: 'messageDraft',
    filter: {
      and: [
        { authorId: { eq: authorId } },
        ...(messageThreadId
          ? [{ messageThreadId: { eq: messageThreadId } }]
          : []),
      ],
    },
    orderBy: [{ lastEditedAt: 'DescNullsLast' }],
    recordGqlFields: MESSAGE_DRAFT_LIST_FIELDS,
    limit: messageThreadId ? 1 : QUERY_MAX_RECORDS,
    skip: !authorId,
  });
