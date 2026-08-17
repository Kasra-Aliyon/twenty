import { gql } from '@apollo/client';

export const UPDATE_CONNECTED_ACCOUNT_SEQUENCE_EMAIL_SETTINGS = gql`
  mutation UpdateConnectedAccountSequenceEmailSettings(
    $id: UUID!
    $input: ConnectedAccountSequenceEmailSettingsInput!
  ) {
    updateConnectedAccountSequenceEmailSettings(id: $id, input: $input) {
      id
      sequenceDailyEmailLimitEnabled
      sequenceDailyEmailLimit
    }
  }
`;
