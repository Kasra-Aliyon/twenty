import { CORE_GRAPHQL_PATH, METADATA_GRAPHQL_PATH } from '../constants.js';
import type {
  GraphqlError,
  RestQueryValue,
  RestRequestOptions,
  TwentyMcpConfig,
} from '../types.js';
import {
  apiErrorFromGraphql,
  apiErrorFromResponse,
  TwentyApiError,
} from './errors.js';

type FetchImplementation = typeof fetch;

type GraphqlEnvelope<TData> = {
  data?: TData;
  errors?: GraphqlError[];
};

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text === '') {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const appendQueryValue = (
  searchParams: URLSearchParams,
  key: string,
  value: RestQueryValue,
): void => {
  if (value === undefined) {
    return;
  }

  if (value === null || typeof value !== 'object') {
    searchParams.set(key, String(value));
    return;
  }

  searchParams.set(key, JSON.stringify(value));
};

export class TwentyClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly userToken: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: FetchImplementation;

  constructor(
    config: Pick<
      TwentyMcpConfig,
      'apiKey' | 'baseUrl' | 'maxRetries' | 'requestTimeoutMs' | 'userToken'
    >,
    fetchImplementation: FetchImplementation = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.userToken = config.userToken;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.maxRetries = config.maxRetries;
    this.fetchImplementation = fetchImplementation;
  }

  hasUserToken(): boolean {
    return this.userToken !== undefined;
  }

  async rest(
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
    path: string,
    options: RestRequestOptions = {},
  ): Promise<unknown> {
    return this.request(method, path, options);
  }

  async graphql<TData>(
    query: string,
    variables: Record<string, unknown> = {},
    options: {
      endpoint?: 'core' | 'metadata';
      token?: 'api' | 'user';
    } = {},
  ): Promise<TData> {
    const body = await this.request(
      'POST',
      options.endpoint === 'metadata'
        ? METADATA_GRAPHQL_PATH
        : CORE_GRAPHQL_PATH,
      {
        body: { query, variables },
        token: options.token,
      },
    );
    const envelope = body as GraphqlEnvelope<TData>;

    if (envelope.errors !== undefined && envelope.errors.length > 0) {
      throw apiErrorFromGraphql(envelope.errors);
    }

    if (envelope.data === undefined) {
      throw new TwentyApiError({
        message: 'Twenty returned a GraphQL response without data.',
        code: 'INVALID_GRAPHQL_RESPONSE',
        details: body,
      });
    }

    return envelope.data;
  }

  private buildUrl(
    path: string,
    query: Record<string, RestQueryValue> | undefined,
  ): URL {
    const url = new URL(this.baseUrl);
    const basePath = url.pathname.replace(/\/+$/, '');
    const requestPath = path.replace(/^\/+/, '');

    url.pathname = `${basePath}/${requestPath}`;

    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        appendQueryValue(url.searchParams, key, value);
      }
    }

    return url;
  }

  private getToken(tokenType: 'api' | 'user' | undefined): string {
    if (tokenType !== 'user') {
      return this.apiKey;
    }

    if (this.userToken === undefined) {
      throw new TwentyApiError({
        message:
          'This operation requires TWENTY_USER_TOKEN because it uses a user-scoped Twenty resolver.',
        code: 'USER_TOKEN_REQUIRED',
      });
    }

    return this.userToken;
  }

  private async request(
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
    path: string,
    options: RestRequestOptions,
  ): Promise<unknown> {
    const url = this.buildUrl(path, options.query);
    const token = this.getToken(options.token);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImplementation(url, {
          method,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            ...(options.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        const responseBody = await parseResponseBody(response);

        if (response.ok) {
          return responseBody;
        }

        const error = apiErrorFromResponse({
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        });

        if (!error.retryable || attempt === this.maxRetries) {
          throw error;
        }
      } catch (error) {
        if (
          error instanceof TwentyApiError &&
          (!error.retryable || attempt === this.maxRetries)
        ) {
          throw error;
        }

        if (attempt === this.maxRetries) {
          throw error;
        }
      }

      await wait(250 * 2 ** attempt);
    }

    throw new TwentyApiError({
      message: 'Twenty request failed after all retry attempts.',
      code: 'RETRY_EXHAUSTED',
    });
  }
}
