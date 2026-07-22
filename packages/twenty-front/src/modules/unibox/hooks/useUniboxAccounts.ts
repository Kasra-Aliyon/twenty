import { useQuery } from '@apollo/client/react';

import { GET_MY_CONNECTED_ACCOUNTS } from '@/settings/accounts/graphql/queries/getMyConnectedAccounts';

type UniboxAccount = {
  id: string;
  handle: string;
  provider: string;
  archivedAt: string | null;
  authFailedAt: string | null;
};

type MyConnectedAccountsData = {
  myConnectedAccounts: UniboxAccount[];
};

const EMAIL_ACCOUNT_PROVIDERS = new Set([
  'GOOGLE',
  'MICROSOFT',
  'IMAP_SMTP_CALDAV',
]);

export const useUniboxAccounts = () => {
  const { data, loading } = useQuery<MyConnectedAccountsData>(
    GET_MY_CONNECTED_ACCOUNTS,
  );

  const accounts = (data?.myConnectedAccounts ?? []).filter(
    (account) =>
      account.archivedAt === null &&
      EMAIL_ACCOUNT_PROVIDERS.has(account.provider),
  );

  return { accounts, loading };
};
