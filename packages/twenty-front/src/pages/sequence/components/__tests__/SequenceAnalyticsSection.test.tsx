import { render, screen } from '@testing-library/react';

import { SequenceAnalyticsSection } from '~/pages/sequence/components/SequenceAnalyticsSection';

const mockUseQuery = jest.fn();

jest.mock('@apollo/client/react', () => ({
  useApolloClient: () => ({ id: 'metadata-client' }),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

describe('SequenceAnalyticsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: {
        sequenceAnalytics: {
          enrolledCount: 20,
          contactedCount: 18,
          sentEmailCount: 24,
          repliedCount: 9,
          completedCount: 5,
          failedCount: 1,
          replyRate: 45.5,
          emailVariants: [
            {
              stepId: 'step-id',
              stepName: 'Email step 1',
              variantId: 'variant-a',
              variantName: 'A',
              sentCount: 12,
              repliedCount: 6,
              replyRate: 50,
            },
          ],
        },
      },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    });
  });

  it('renders all-time totals and per-variant results', () => {
    render(<SequenceAnalyticsSection sequenceId="sequence-id" />);

    expect(screen.getByText('All-time performance')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('45.5%')).toBeInTheDocument();
    expect(screen.getByText('Email step 1')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variables: { sequenceId: 'sequence-id' },
      }),
    );
    expect(mockUseQuery.mock.calls[0][1]).not.toHaveProperty('pollInterval');
    expect(
      screen.getByRole('button', { name: /^Refresh/ }),
    ).toBeInTheDocument();
  });
});
