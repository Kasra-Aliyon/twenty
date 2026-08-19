import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { ApolloClientService } from 'src/modules/apollo-enrichment/services/apollo-client.service';

describe('ApolloClientService', () => {
  const httpClient = {
    post: jest.fn(),
    get: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
  };
  const secureHttpClientService = {
    getHttpClient: jest.fn(
      (_config?: { transformResponse?: unknown }) => httpClient,
    ),
  };
  const twentyConfigService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        APOLLO_API_KEY: 'api-key',
        APOLLO_API_BASE_URL: 'https://api.apollo.io/api/v1',
        SERVER_URL: 'https://twenty.example.com',
      };

      return values[key];
    }),
  };
  const service = new ApolloClientService(
    secureHttpClientService as unknown as SecureHttpClientService,
    twentyConfigService as unknown as TwentyConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns immediately while Apollo delivers phone results asynchronously', async () => {
    httpClient.post.mockResolvedValue({
      data: {
        request_id: 'request-id',
        person: {
          id: 'apollo-person-id',
          email: 'jane@example.com',
        },
      },
    });
    await expect(
      service.enrichPerson(
        {
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        {
          revealPersonalEmails: false,
          revealPhoneNumber: true,
          webhookUrl:
            'https://twenty.example.com/webhooks/apollo/enrichment/token',
        },
      ),
    ).resolves.toEqual({
      request_id: 'request-id',
      person: {
        id: 'apollo-person-id',
        email: 'jane@example.com',
      },
    });
    expect(httpClient.post).toHaveBeenCalledWith('/people/match', undefined, {
      params: {
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        reveal_personal_emails: false,
        reveal_phone_number: true,
        webhook_url:
          'https://twenty.example.com/webhooks/apollo/enrichment/token',
      },
    });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('does not request or poll phone data during general enrichment', async () => {
    httpClient.post.mockResolvedValue({
      data: {
        person: {
          email: 'jane@example.com',
        },
      },
    });

    await service.enrichPerson(
      {
        linkedinUrl: 'https://www.linkedin.com/in/jane',
      },
      {
        revealPersonalEmails: true,
        revealPhoneNumber: false,
      },
    );

    expect(httpClient.post).toHaveBeenCalledWith('/people/match', undefined, {
      params: {
        linkedin_url: 'https://www.linkedin.com/in/jane',
        reveal_personal_emails: true,
        reveal_phone_number: false,
      },
    });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('does not call Apollo when the durable provider-start callback rejects', async () => {
    const startError = new Error('sequence was paused');
    const onProviderStart = jest.fn().mockRejectedValue(startError);

    await expect(
      service.enrichPerson(
        { linkedinUrl: 'https://www.linkedin.com/in/jane' },
        {
          revealPersonalEmails: false,
          revealPhoneNumber: true,
          webhookUrl:
            'https://twenty.example.com/webhooks/apollo/enrichment/token',
        },
        onProviderStart,
      ),
    ).rejects.toBe(startError);

    expect(onProviderStart).toHaveBeenCalledTimes(1);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('runs the durable provider-start callback immediately before Apollo HTTP', async () => {
    const events: string[] = [];
    const onProviderStart = jest.fn(async () => {
      events.push('provider-start');
    });

    httpClient.post.mockImplementation(async () => {
      events.push('http-post');

      return { data: { person: null } };
    });

    await service.enrichPerson(
      { linkedinUrl: 'https://www.linkedin.com/in/jane' },
      {
        revealPersonalEmails: false,
        revealPhoneNumber: true,
        webhookUrl:
          'https://twenty.example.com/webhooks/apollo/enrichment/token',
      },
      onProviderStart,
    );

    expect(events).toEqual(['provider-start', 'http-post']);
  });

  it('preserves signed 64-bit Apollo request IDs while parsing responses', async () => {
    httpClient.post.mockResolvedValue({
      data: {
        person: {
          email: 'jane@example.com',
        },
      },
    });

    await service.enrichPerson({
      email: 'jane@example.com',
    });

    const clientConfig = secureHttpClientService.getHttpClient.mock.calls[0][0];
    const transformResponse = clientConfig?.transformResponse as [
      (data: unknown) => unknown,
    ];

    expect(
      transformResponse[0](
        '{"request_id":1039995589705121900,"person":{"id":"person-id"}}',
      ),
    ).toEqual({
      request_id: '1039995589705121900',
      person: {
        id: 'person-id',
      },
    });
  });
});
