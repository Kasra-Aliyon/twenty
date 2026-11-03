import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_METADATA_CACHE_TTL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './constants.js';
import type { TransportMode, TwentyMcpConfig } from './types.js';
import { z } from 'zod';

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
  const userId = environment.TWENTY_MCP_USER_ID;
  const workspaceId = environment.TWENTY_MCP_WORKSPACE_ID;
  const publicCrmOrigin = environment.TWENTY_MCP_PUBLIC_CRM_ORIGIN;
  if (userId || workspaceId || publicCrmOrigin) {
    if (
      !z.uuid().safeParse(userId).success ||
      !z.uuid().safeParse(workspaceId).success ||
      !environment.TWENTY_USER_SESSION_FILE ||
      environment.TWENTY_USER_TOKEN
    ) {
      throw new Error(
        'Personal MCP requires valid TWENTY_MCP_USER_ID, TWENTY_MCP_WORKSPACE_ID and TWENTY_USER_SESSION_FILE, without TWENTY_USER_TOKEN',
      );
    }
    if (publicCrmOrigin) {
      const origin = new URL(publicCrmOrigin);
      if (origin.protocol !== 'https:' || origin.origin !== publicCrmOrigin) {
        throw new Error('TWENTY_MCP_PUBLIC_CRM_ORIGIN must be an HTTPS origin');
      }
      if (!httpBearerToken) {
        throw new Error(
          'Personal MCP onboarding requires an HTTP bearer token',
        );
      }
    }
  }
  const allowedOrigins = (environment.TWENTY_MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);

      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          'TWENTY_MCP_ALLOWED_ORIGINS must contain HTTPS origins',
        );
      }

      return url.origin;
    });

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
    ...(userId && workspaceId
      ? { userSessionIdentity: { userId, workspaceId } }
      : {}),
    ...(publicCrmOrigin ? { publicCrmOrigin } : {}),
    ...(environment.TWENTY_USER_TOKEN
      ? { userToken: environment.TWENTY_USER_TOKEN }
      : {}),
    ...(environment.TWENTY_USER_SESSION_FILE
      ? { userSessionFile: environment.TWENTY_USER_SESSION_FILE }
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
    enableSchemaTools: environment.TWENTY_ENABLE_SCHEMA_TOOLS === 'true',
    transport,
    allowedOrigins,
    host,
    port: readPositiveInteger(environment.PORT, DEFAULT_HTTP_PORT, 'PORT'),
    ...(httpBearerToken === undefined || httpBearerToken.trim() === ''
      ? {}
      : { httpBearerToken }),
  };
};

export const configTesting = { isLoopbackHost };
