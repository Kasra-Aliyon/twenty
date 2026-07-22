import { gql } from '@apollo/client';

export const ADD_UNIBOX_CONTACTS_TO_CRM = gql`
  mutation AddUniboxContactsToCrm($input: AddUniboxContactsToCrmInput!) {
    addUniboxContactsToCrm(input: $input) {
      createdPersonCount
      alreadyExistingCount
      personIds
    }
  }
`;
