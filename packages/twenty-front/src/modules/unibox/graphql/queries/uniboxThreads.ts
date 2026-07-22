import { gql } from '@apollo/client';

export const UNIBOX_THREADS = gql`
  query UniboxThreads($input: UniboxThreadsInput!) {
    uniboxThreads(input: $input) {
      totalCount
      threads {
        id
        channel
        subject
        lastMessagePreview
        lastMessageAt
        messageCount
        isRead
        participants {
          displayName
          handle
          avatarUrl
          personId
        }
        hasCrmContact
        connectedAccountId
      }
    }
  }
`;
