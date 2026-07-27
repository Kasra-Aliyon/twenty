import type { GraphqlError } from '../types.js';

export class TwentyApiError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor({
    message,
    status,
    code,
    details,
    retryable = false,
  }: {
    message: string;
    status?: number;
    code?: string;
    details?: unknown;
    retryable?: boolean;
  }) {
    super(message);
    this.name = 'TwentyApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

const getStringProperty = (
  value: unknown,
  property: string,
): string | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(property in value) ||
    typeof value[property as keyof typeof value] !== 'string'
  ) {
    return undefined;
  }

  return value[property as keyof typeof value] as string;
};

const findErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === 'string' && body.trim() !== '') {
    return body;
  }

  const directMessage = getStringProperty(body, 'message');

  if (directMessage !== undefined) {
    return directMessage;
  }

  if (typeof body === 'object' && body !== null && 'error' in body) {
    const nestedMessage = getStringProperty(body.error, 'message');

    if (nestedMessage !== undefined) {
      return nestedMessage;
    }
  }

  return fallback;
};

export const apiErrorFromResponse = ({
  status,
  statusText,
  body,
}: {
  status: number;
  statusText: string;
  body: unknown;
}): TwentyApiError => {
  const code =
    getStringProperty(body, 'code') ??
    (typeof body === 'object' && body !== null && 'error' in body
      ? getStringProperty(body.error, 'code')
      : undefined);

  let guidance = '';

  if (status === 401) {
    guidance =
      ' Check TWENTY_API_KEY (or TWENTY_USER_TOKEN for user-scoped tools) and ensure it has not expired.';
  } else if (status === 403) {
    guidance =
      " The token's role lacks permission for this operation. Metadata discovery may require Data Model read permission.";
  } else if (status === 404) {
    guidance =
      ' Confirm the object plural slug and record ID with twenty_list_objects or twenty_describe_object.';
  } else if (status === 429) {
    guidance = ' Twenty rate-limited the request; retry after a short delay.';
  }

  return new TwentyApiError({
    message: `${findErrorMessage(body, `${status} ${statusText}`)}${guidance}`,
    status,
    ...(code === undefined ? {} : { code }),
    details: body,
    retryable: status === 429 || status >= 500,
  });
};

export const apiErrorFromGraphql = (errors: GraphqlError[]): TwentyApiError => {
  const messages = errors.map((error) => error.message).join('; ');
  const authFailure = errors.some((error) =>
    /unauthori[sz]ed|forbidden|user.*required/i.test(error.message),
  );

  return new TwentyApiError({
    message: authFailure
      ? `${messages} User-scoped resolvers require TWENTY_USER_TOKEN when the API key has no user context.`
      : messages,
    code: 'GRAPHQL_ERROR',
    details: errors,
    retryable: false,
  });
};

export const normalizeErrorMessage = (error: unknown): string => {
  if (error instanceof TwentyApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
};
