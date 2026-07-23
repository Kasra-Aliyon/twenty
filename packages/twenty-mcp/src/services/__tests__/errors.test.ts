import {
  apiErrorFromGraphql,
  apiErrorFromResponse,
  normalizeErrorMessage,
  TwentyApiError,
} from '../errors.js';

describe('Twenty API errors', () => {
  it('extracts nested REST error details and permission guidance', () => {
    const error = apiErrorFromResponse({
      status: 403,
      statusText: 'Forbidden',
      body: {
        error: {
          message: 'Missing permission',
          code: 'FORBIDDEN',
        },
      },
    });

    expect(error).toBeInstanceOf(TwentyApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Missing permission');
    expect(error.message).toContain('Data Model read permission');
  });

  it('marks rate limits and server failures as retryable', () => {
    expect(
      apiErrorFromResponse({
        status: 429,
        statusText: 'Too Many Requests',
        body: null,
      }).retryable,
    ).toBe(true);
    expect(
      apiErrorFromResponse({
        status: 503,
        statusText: 'Unavailable',
        body: null,
      }).retryable,
    ).toBe(true);
  });

  it('adds user-token guidance to authentication-shaped GraphQL errors', () => {
    const error = apiErrorFromGraphql([
      { message: 'Unauthorized user context' },
      { message: 'Second failure' },
    ]);

    expect(error.code).toBe('GRAPHQL_ERROR');
    expect(error.message).toContain('TWENTY_USER_TOKEN');
    expect(normalizeErrorMessage(error)).toBe(error.message);
  });
});
