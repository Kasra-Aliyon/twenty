const APOLLO_WEBHOOK_PATH_PATTERN =
  /^\/webhooks\/apollo\/enrichment\/[^/?]+(?:\?.*)?$/;
const DEFAULT_DEVELOPMENT_SERVER_PORT = 2000;
const MAXIMUM_TCP_PORT = 65_535;

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getEnvironmentValue = (
  contents: string,
  variableName: string,
): string | undefined => {
  const escapedVariableName = escapeRegularExpression(variableName);
  const match = contents.match(
    new RegExp(`^(?:export\\s+)?${escapedVariableName}=(.*)$`, 'm'),
  );

  if (!match) {
    return undefined;
  }

  const value = match[1].trim();
  const hasMatchingQuotes =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));

  return hasMatchingQuotes ? value.slice(1, -1) : value;
};

export const resolveDevelopmentServerPort = (
  serverEnvironment: string,
  processEnvironmentPort: string | undefined,
): number => {
  const rawPort =
    processEnvironmentPort ??
    getEnvironmentValue(serverEnvironment, 'NODE_PORT');

  if (rawPort === undefined) {
    return DEFAULT_DEVELOPMENT_SERVER_PORT;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > MAXIMUM_TCP_PORT) {
    throw new Error(
      `NODE_PORT must be an integer between 1 and ${MAXIMUM_TCP_PORT}`,
    );
  }

  return port;
};

export const setEnvironmentValue = (
  contents: string,
  variableName: string,
  value: string,
): string => {
  const escapedVariableName = escapeRegularExpression(variableName);
  const variablePattern = new RegExp(
    `^(?:export\\s+)?${escapedVariableName}=.*$`,
    'm',
  );
  const nextLine = `${variableName}=${value}`;

  if (variablePattern.test(contents)) {
    return contents.replace(variablePattern, nextLine);
  }

  return `${contents.trimEnd()}\n${nextLine}\n`;
};

export const isManagedQuickTunnelUrl = (baseUrl: string | undefined): boolean =>
  !baseUrl || /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(baseUrl);

export const isAllowedApolloWebhookRequest = (
  method: string | undefined,
  requestUrl: string | undefined,
): boolean =>
  method === 'POST' &&
  typeof requestUrl === 'string' &&
  APOLLO_WEBHOOK_PATH_PATTERN.test(requestUrl);
