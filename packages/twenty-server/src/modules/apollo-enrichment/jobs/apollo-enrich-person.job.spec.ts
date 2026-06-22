import { ApolloEnrichPersonJob } from 'src/modules/apollo-enrichment/jobs/apollo-enrich-person.job';
import { type ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { ApolloEnrichmentError } from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';

describe('ApolloEnrichPersonJob', () => {
  const enrichPerson = jest.fn();
  const job = new ApolloEnrichPersonJob({
    enrichPerson,
  } as unknown as ApolloEnrichmentService);
  const jobData = {
    workspaceId: 'workspace-id',
    personId: 'person-id',
    trigger: 'backfill' as const,
  };

  beforeEach(() => {
    enrichPerson.mockReset();
  });

  it('swallows non-retryable Apollo errors', async () => {
    enrichPerson.mockRejectedValue(
      new ApolloEnrichmentError('Unauthorized', false, 401),
    );

    await expect(job.handle(jobData)).resolves.toBeUndefined();
  });

  it('rethrows retryable Apollo errors', async () => {
    const error = new ApolloEnrichmentError('Rate limited', true, 429);

    enrichPerson.mockRejectedValue(error);

    await expect(job.handle(jobData)).rejects.toThrow(error);
  });
});
