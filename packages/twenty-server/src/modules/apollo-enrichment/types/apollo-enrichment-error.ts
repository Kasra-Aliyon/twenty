export class ApolloEnrichmentError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = ApolloEnrichmentError.name;
  }
}
