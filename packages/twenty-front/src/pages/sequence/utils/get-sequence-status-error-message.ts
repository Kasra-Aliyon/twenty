import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { isNonEmptyString } from '@sniptt/guards';

import { isGraphqlErrorOfType } from '~/utils/is-graphql-error-of-type.util';

const BAD_USER_INPUT_ERROR_CODE = 'BAD_USER_INPUT';

export const getSequenceStatusErrorMessage = ({
  error,
  fallbackMessage,
}: {
  error: unknown;
  fallbackMessage: string;
}): string => {
  if (!CombinedGraphQLErrors.is(error)) {
    return fallbackMessage;
  }

  const validationError = error.errors.find(
    (graphQLError) =>
      isGraphqlErrorOfType(graphQLError, BAD_USER_INPUT_ERROR_CODE) &&
      isNonEmptyString(graphQLError.message),
  );

  return validationError?.message.trim() || fallbackMessage;
};
