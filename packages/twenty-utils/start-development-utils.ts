const APOLLO_WEBHOOK_PATH_PATTERN =
  /^\/webhooks\/apollo\/enrichment\/[^/?]+(?:\?.*)?$/;

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

export const isManagedQuickTunnelUrl = (
  baseUrl: string | undefined,
): boolean =>
  !baseUrl ||
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(baseUrl);

export const isAllowedApolloWebhookRequest = (
  method: string | undefined,
  requestUrl: string | undefined,
): boolean =>
  method === 'POST' &&
  typeof requestUrl === 'string' &&
  APOLLO_WEBHOOK_PATH_PATTERN.test(requestUrl);
