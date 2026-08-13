import { gql } from '@apollo/client';

export const ENRICH_PEOPLE_WITH_APOLLO = gql`
  mutation EnrichPeopleWithApollo($input: ApolloEnrichRecordsInput!) {
    enrichPeopleWithApollo(input: $input) {
      requestedCount
      updatedCount
      pendingCount
      skippedCount
      notMatchedCount
      notFoundCount
      failedCount
      disabled
    }
  }
`;

export const ENRICH_PEOPLE_PHONES_WITH_APOLLO = gql`
  mutation EnrichPeoplePhonesWithApollo($input: ApolloEnrichRecordsInput!) {
    enrichPeoplePhonesWithApollo(input: $input) {
      requestedCount
      updatedCount
      pendingCount
      skippedCount
      notMatchedCount
      notFoundCount
      failedCount
      disabled
    }
  }
`;

export const ENRICH_COMPANIES_WITH_APOLLO = gql`
  mutation EnrichCompaniesWithApollo($input: ApolloEnrichRecordsInput!) {
    enrichCompaniesWithApollo(input: $input) {
      requestedCount
      updatedCount
      pendingCount
      skippedCount
      notMatchedCount
      notFoundCount
      failedCount
      disabled
    }
  }
`;
