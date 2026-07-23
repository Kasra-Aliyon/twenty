import type { TwentyMcpConfig } from '../../types.js';
import type { TwentyApiError } from '../errors.js';
import { TwentyClient } from '../twenty-client.js';

const baseConfig: Pick<
  TwentyMcpConfig,
  'apiKey' | 'baseUrl' | 'maxRetries' | 'requestTimeoutMs' | 'userToken'
> = {
  apiKey: 'api-key',
  baseUrl: new URL('https://crm.example.com/base/'),
  maxRetries: 0,
  requestTimeoutMs: 1_000,
  userToken: 'user-token',
};

describe('TwentyClient', () => {
  it('builds REST URLs, JSON query values, and bearer authentication', async () => {
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: { people: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new TwentyClient(
      baseConfig,
      fetchMock as unknown as typeof fetch,
    );

    await client.rest('GET', '/rest/people', {
      query: {
        limit: 20,
        group_by: [{ stage: true }],
        ignored: undefined,
      },
    });

    const [url, request] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toContain('/base/rest/people?');
    expect(String(url)).toContain('limit=20');
    expect(String(url)).toContain('group_by=%5B%7B%22stage%22%3Atrue%7D%5D');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer api-key',
    });
  });

  it('uses the user token only when explicitly requested', async () => {
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: { value: true } }), {
          status: 200,
        }),
    );
    const client = new TwentyClient(
      baseConfig,
      fetchMock as unknown as typeof fetch,
    );

    await client.graphql('query Test { value }', {}, { token: 'user' });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer user-token',
      'content-type': 'application/json',
    });
  });

  it('normalizes non-success responses into actionable errors', async () => {
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: { message: 'Not allowed', code: 'FORBIDDEN' },
          }),
          { status: 403, statusText: 'Forbidden' },
        ),
    );
    const client = new TwentyClient(
      baseConfig,
      fetchMock as unknown as typeof fetch,
    );

    await expect(client.rest('GET', '/rest/people')).rejects.toMatchObject({
      name: 'TwentyApiError',
      code: 'FORBIDDEN',
      status: 403,
      retryable: false,
    } satisfies Partial<TwentyApiError>);
  });

  it('rejects user-scoped operations without a user token', async () => {
    const client = new TwentyClient(
      { ...baseConfig, userToken: undefined },
      jest.fn() as unknown as typeof fetch,
    );

    await expect(
      client.graphql('query Test { value }', {}, { token: 'user' }),
    ).rejects.toMatchObject({ code: 'USER_TOKEN_REQUIRED' });
  });
});
