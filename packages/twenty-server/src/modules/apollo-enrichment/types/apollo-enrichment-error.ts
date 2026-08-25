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

// The caller's durable admission callback may already have committed, but the
// Apollo HTTP request is still definitely unstarted when this error is thrown.
export class ApolloEnrichmentProviderNotStartedError extends ApolloEnrichmentError {
  constructor(message: string) {
    super(message, true);
    this.name = ApolloEnrichmentProviderNotStartedError.name;
  }
}

// Apollo returned a concrete HTTP rejection, so no asynchronous webhook will
// arrive even though the durable provider boundary callback already ran.
export class ApolloEnrichmentProviderRejectedError extends ApolloEnrichmentError {
  constructor(message: string, retryable: boolean, statusCode: number) {
    super(message, retryable, statusCode);
    this.name = ApolloEnrichmentProviderRejectedError.name;
  }
}
