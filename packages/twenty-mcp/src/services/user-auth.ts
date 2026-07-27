import { TwentyApiError } from './errors.js';
import type { TwentyClient } from './twenty-client.js';

export const requireUserToken = (client: TwentyClient): 'user' => {
  if (!client.hasUserToken()) {
    throw new TwentyApiError({
      message:
        'This tool requires TWENTY_USER_TOKEN because Twenty restricts this workflow to a user context.',
      code: 'USER_TOKEN_REQUIRED',
    });
  }

  return 'user';
};
