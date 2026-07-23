import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_METADATA_CACHE_TTL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './constants.js';
import type { TransportMode, TwentyMcpConfig } from './types.js';

const readPositiveInteger = (
  value: string | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return parsed;
};

const readTransport = (value: string | undefined): TransportMode => {
  if (value === undefined || value === '' || value === 'stdio') {
    return 'stdio';
  }

  if (value === 'http') {
    return 'http';
  }

  throw new Error('TRANSPORT must be either "stdio" or "http"');
};

const isLoopbackHost = (host: string): boolean =>
  host === '127.0.0.1' || host === '::1' || host === 'localhost';

export const readConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): TwentyMcpConfig => {
  const rawBaseUrl = environment.TWENTY_BASE_URL;
  const apiKey = environment.TWENTY_API_KEY;

  if (rawBaseUrl === undefined || rawBaseUrl.trim() === '') {
    throw new Error('TWENTY_BASE_URL is required');
  }

  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('TWENTY_API_KEY is required');
  }

  const baseUrl = new URL(rawBaseUrl);

  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('TWENTY_BASE_URL must use http or https');
  }

  const transport = readTransport(environment.TRANSPORT);
  const host = environment.HOST ?? DEFAULT_HTTP_HOST;
  const httpBearerToken = environment.TWENTY_MCP_HTTP_BEARER_TOKEN;

  if (
    transport === 'http' &&
    !isLoopbackHost(host) &&
    (httpBearerToken === undefined || httpBearerToken.trim() === '')
  ) {
    throw new Error(
      'TWENTY_MCP_HTTP_BEARER_TOKEN is required when HTTP binds outside loopback',
    );
  }

  return {
    baseUrl,
    apiKey,
    ...(environment.TWENTY_USER_TOKEN
      ? { userToken: environment.TWENTY_USER_TOKEN }
      : {}),
    metadataCacheTtlMs: readPositiveInteger(
      environment.TWENTY_METADATA_CACHE_TTL_MS,
      DEFAULT_METADATA_CACHE_TTL_MS,
      'TWENTY_METADATA_CACHE_TTL_MS',
    ),
    requestTimeoutMs: readPositiveInteger(
      environment.TWENTY_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      'TWENTY_REQUEST_TIMEOUT_MS',
    ),
    maxRetries: readPositiveInteger(
      environment.TWENTY_MAX_RETRIES,
      DEFAULT_MAX_RETRIES,
      'TWENTY_MAX_RETRIES',
    ),
    enableAdvanced: environment.TWENTY_ENABLE_ADVANCED === 'true',
    transport,
    host,
    port: readPositiveInteger(environment.PORT, DEFAULT_HTTP_PORT, 'PORT'),
    ...(httpBearerToken === undefined || httpBearerToken.trim() === ''
      ? {}
      : { httpBearerToken }),
  };
};

export const configTesting = { isLoopbackHost };
