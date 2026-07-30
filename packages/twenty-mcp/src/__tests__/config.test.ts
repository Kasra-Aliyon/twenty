import { readConfig } from '../config.js';
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_METADATA_CACHE_TTL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from '../constants.js';

describe('readConfig', () => {
  it('reads required values and applies safe defaults', () => {
    const config = readConfig({
      TWENTY_BASE_URL: 'https://crm.example.com',
      TWENTY_API_KEY: 'test-api-key',
    });

    expect(config).toMatchObject({
      apiKey: 'test-api-key',
      metadataCacheTtlMs: DEFAULT_METADATA_CACHE_TTL_MS,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
      enableAdvanced: false,
      transport: 'stdio',
      host: DEFAULT_HTTP_HOST,
      port: DEFAULT_HTTP_PORT,
    });
    expect(config.baseUrl.href).toBe('https://crm.example.com/');
  });

  it('reads optional HTTP and user-scoped settings', () => {
    const config = readConfig({
      TWENTY_BASE_URL: 'http://localhost:2000/base',
      TWENTY_API_KEY: 'test-api-key',
      TWENTY_USER_TOKEN: 'test-user-token',
      TWENTY_ENABLE_ADVANCED: 'true',
      TRANSPORT: 'http',
      HOST: '0.0.0.0',
      PORT: '4444',
      TWENTY_MCP_HTTP_BEARER_TOKEN: 'mcp-http-token',
      TWENTY_MAX_RETRIES: '0',
    });

    expect(config).toMatchObject({
      userToken: 'test-user-token',
      enableAdvanced: true,
      transport: 'http',
      host: '0.0.0.0',
      port: 4444,
      maxRetries: 0,
      httpBearerToken: 'mcp-http-token',
    });
  });

  it.each([
    [{ TWENTY_API_KEY: 'key' }, 'TWENTY_BASE_URL is required'],
    [
      { TWENTY_BASE_URL: 'https://crm.example.com' },
      'TWENTY_API_KEY is required',
    ],
    [
      {
        TWENTY_BASE_URL: 'file:///tmp/twenty',
        TWENTY_API_KEY: 'key',
      },
      'TWENTY_BASE_URL must use http or https',
    ],
    [
      {
        TWENTY_BASE_URL: 'https://crm.example.com',
        TWENTY_API_KEY: 'key',
        TRANSPORT: 'websocket',
      },
      'TRANSPORT must be either "stdio" or "http"',
    ],
    [
      {
        TWENTY_BASE_URL: 'https://crm.example.com',
        TWENTY_API_KEY: 'key',
        TRANSPORT: 'http',
        HOST: '0.0.0.0',
      },
      'TWENTY_MCP_HTTP_BEARER_TOKEN is required when HTTP binds outside loopback',
    ],
  ])('rejects invalid configuration', (environment, message) => {
    expect(() => readConfig(environment)).toThrow(message);
  });
});
