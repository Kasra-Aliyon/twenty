import { gql } from '@apollo/client';

export const SEQUENCE_ANALYTICS = gql`
  query SequenceAnalytics($sequenceId: UUID!) {
    sequenceAnalytics(sequenceId: $sequenceId) {
      enrolledCount
      contactedCount
      sentEmailCount
      repliedCount
      completedCount
      failedCount
      replyRate
      emailVariants {
        stepId
        stepName
        variantId
        variantName
        sentCount
        repliedCount
        replyRate
      }
    }
  }
`;
