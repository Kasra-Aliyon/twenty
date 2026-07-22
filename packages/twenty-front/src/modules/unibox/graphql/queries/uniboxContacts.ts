import { gql } from '@apollo/client';

export const UNIBOX_CONTACTS = gql`
  query UniboxContacts($input: UniboxContactsInput!) {
    uniboxContacts(input: $input) {
      totalCount
      contacts {
        handle
        displayName
        personId
        messageCount
        lastContactedAt
        firstContactedAt
      }
    }
  }
`;
