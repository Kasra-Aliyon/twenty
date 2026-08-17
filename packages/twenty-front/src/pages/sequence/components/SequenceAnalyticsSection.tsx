import { useApolloClient, useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/input';
import { Card, CardContent } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { SEQUENCE_ANALYTICS } from '../graphql/queries/sequenceAnalytics';
import { StyledEmptyState, StyledSectionTitle } from './SequencePageStyles';

type SequenceEmailVariantAnalytics = {
  stepId: string;
  stepName: string;
  variantId: string;
  variantName: string;
  sentCount: number;
  repliedCount: number;
  replyRate: number;
};

type SequenceAnalytics = {
  enrolledCount: number;
  contactedCount: number;
  sentEmailCount: number;
  repliedCount: number;
  completedCount: number;
  failedCount: number;
  replyRate: number;
  emailVariants: SequenceEmailVariantAnalytics[];
};

type SequenceAnalyticsQueryData = {
  sequenceAnalytics: SequenceAnalytics;
};

type SequenceAnalyticsQueryVariables = {
  sequenceId: string;
};

const StyledAnalytics = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[5]};
`;

const StyledSectionHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledMetricGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
`;

const StyledMetricLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledMetricValue = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledTableContainer = styled.div`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  overflow: auto;
`;

const StyledTable = styled.table`
  border-collapse: collapse;
  min-width: 640px;
  width: 100%;
`;

const StyledHeaderCell = styled.th`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[3]};
  text-align: left;
`;

const StyledCell = styled.td`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.secondary};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledStepName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledSubtleText = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const formatRate = (rate: number) => `${Math.round(rate * 10) / 10}%`;

export const SequenceAnalyticsSection = ({
  sequenceId,
}: {
  sequenceId: string;
}) => {
  const apolloClient = useApolloClient();
  const { data, loading, error, refetch } = useQuery<
    SequenceAnalyticsQueryData,
    SequenceAnalyticsQueryVariables
  >(SEQUENCE_ANALYTICS, {
    client: apolloClient,
    variables: { sequenceId },
  });

  if (loading && !data) {
    return <StyledEmptyState>{t`Loading analytics…`}</StyledEmptyState>;
  }

  if (error || !data) {
    return (
      <StyledEmptyState>
        <span>{t`Sequence analytics could not be loaded.`}</span>
        <Button
          title={t`Try again`}
          size="small"
          variant="secondary"
          onClick={() => void refetch()}
        />
      </StyledEmptyState>
    );
  }

  const analytics = data.sequenceAnalytics;
  const metrics = [
    { label: t`Enrolled`, value: analytics.enrolledCount },
    { label: t`Emailed contacts`, value: analytics.contactedCount },
    { label: t`Emails sent`, value: analytics.sentEmailCount },
    { label: t`Replies`, value: analytics.repliedCount },
    { label: t`Reply rate`, value: formatRate(analytics.replyRate) },
    { label: t`Completed`, value: analytics.completedCount },
    { label: t`Failed`, value: analytics.failedCount },
  ];

  return (
    <StyledAnalytics>
      <div>
        <StyledSectionHeader>
          <StyledSectionTitle>{t`All-time performance`}</StyledSectionTitle>
          <Button
            title={t`Refresh`}
            size="small"
            variant="secondary"
            onClick={() => void refetch()}
          />
        </StyledSectionHeader>
        <StyledMetricGrid>
          {metrics.map((metric) => (
            <Card key={metric.label} rounded>
              <CardContent>
                <StyledMetricLabel>{metric.label}</StyledMetricLabel>
                <StyledMetricValue>{metric.value}</StyledMetricValue>
              </CardContent>
            </Card>
          ))}
        </StyledMetricGrid>
      </div>

      <div>
        <StyledSectionTitle>{t`Email variant performance`}</StyledSectionTitle>
        {analytics.emailVariants.length > 0 ? (
          <StyledTableContainer>
            <StyledTable>
              <thead>
                <tr>
                  <StyledHeaderCell>{t`Step`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Variant`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Sent`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Replies`}</StyledHeaderCell>
                  <StyledHeaderCell>{t`Reply rate`}</StyledHeaderCell>
                </tr>
              </thead>
              <tbody>
                {analytics.emailVariants.map((variant) => (
                  <tr key={`${variant.stepId}-${variant.variantId}`}>
                    <StyledCell>
                      <StyledStepName>{variant.stepName}</StyledStepName>
                      <StyledSubtleText>{variant.stepId}</StyledSubtleText>
                    </StyledCell>
                    <StyledCell>{variant.variantName}</StyledCell>
                    <StyledCell>{variant.sentCount}</StyledCell>
                    <StyledCell>{variant.repliedCount}</StyledCell>
                    <StyledCell>{formatRate(variant.replyRate)}</StyledCell>
                  </tr>
                ))}
              </tbody>
            </StyledTable>
          </StyledTableContainer>
        ) : (
          <StyledEmptyState>
            {t`Variant results appear after an automated sequence email is sent.`}
          </StyledEmptyState>
        )}
      </div>
    </StyledAnalytics>
  );
};
