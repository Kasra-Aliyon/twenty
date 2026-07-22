import { NetworkStatus } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useMemo } from 'react';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { ADD_UNIBOX_CONTACTS_TO_CRM } from '@/unibox/graphql/mutations/addUniboxContactsToCrm';
import { UNIBOX_CONTACTS } from '@/unibox/graphql/queries/uniboxContacts';
import {
  type UniboxContact,
  type UniboxContactCrmFilter,
  type UniboxContactSince,
} from '@/unibox/types/UniboxThread';

const UNIBOX_CONTACTS_PAGE_SIZE = 30;
const UNIBOX_SELECT_ALL_PAGE_SIZE = 100;
const UNIBOX_ADD_CONTACTS_BATCH_SIZE = 1_000;

type UniboxContactsData = {
  uniboxContacts: { totalCount: number; contacts: UniboxContact[] };
};

type UniboxContactsVariables = {
  input: {
    search?: string;
    since: UniboxContactSince;
    inCrmFilter: UniboxContactCrmFilter;
    page: number;
    pageSize: number;
  };
};

type AddContactsData = {
  addUniboxContactsToCrm: {
    createdPersonCount: number;
    alreadyExistingCount: number;
    personIds: string[];
  };
};

type AddContactsVariables = {
  input: { handles: string[]; recordListId?: string };
};

export const useUniboxContacts = ({
  search,
  since,
  inCrmFilter,
}: {
  search: string;
  since: UniboxContactSince;
  inCrmFilter: UniboxContactCrmFilter;
}) => {
  const apolloCoreClient = useApolloCoreClient();
  const variables = useMemo<UniboxContactsVariables>(
    () => ({
      input: {
        search: search.trim() || undefined,
        since,
        inCrmFilter,
        page: 1,
        pageSize: UNIBOX_CONTACTS_PAGE_SIZE,
      },
    }),
    [inCrmFilter, search, since],
  );
  const { data, loading, networkStatus, fetchMore, refetch, error } = useQuery<
    UniboxContactsData,
    UniboxContactsVariables
  >(UNIBOX_CONTACTS, {
    client: apolloCoreClient,
    variables,
    notifyOnNetworkStatusChange: true,
  });
  const [addContactsMutation, { loading: isAdding }] = useMutation<
    AddContactsData,
    AddContactsVariables
  >(ADD_UNIBOX_CONTACTS_TO_CRM, { client: apolloCoreClient });

  const contacts = data?.uniboxContacts.contacts ?? [];
  const totalCount = data?.uniboxContacts.totalCount ?? 0;
  const hasNextPage = contacts.length < totalCount;

  const fetchMoreContacts = async () => {
    if (!hasNextPage || networkStatus === NetworkStatus.fetchMore) return;

    await fetchMore({
      variables: {
        input: {
          ...variables.input,
          page: Math.floor(contacts.length / UNIBOX_CONTACTS_PAGE_SIZE) + 1,
        },
      },
      updateQuery: (previousData, { fetchMoreResult }) => ({
        uniboxContacts: {
          ...fetchMoreResult.uniboxContacts,
          contacts: [
            ...previousData.uniboxContacts.contacts,
            ...fetchMoreResult.uniboxContacts.contacts.filter(
              (contact) =>
                !previousData.uniboxContacts.contacts.some(
                  (currentContact) => currentContact.handle === contact.handle,
                ),
            ),
          ],
        },
      }),
    });
  };

  const fetchAllMatchingHandles = useCallback(async () => {
    const handles = new Set<string>();
    const pageCount = Math.ceil(totalCount / UNIBOX_SELECT_ALL_PAGE_SIZE);

    for (let page = 1; page <= pageCount; page += 1) {
      const result = await apolloCoreClient.query<
        UniboxContactsData,
        UniboxContactsVariables
      >({
        query: UNIBOX_CONTACTS,
        variables: {
          input: {
            ...variables.input,
            page,
            pageSize: UNIBOX_SELECT_ALL_PAGE_SIZE,
          },
        },
        fetchPolicy: 'network-only',
      });

      for (const contact of result.data?.uniboxContacts.contacts ?? []) {
        handles.add(contact.handle);
      }
    }

    return [...handles];
  }, [apolloCoreClient, totalCount, variables.input]);

  const addContacts = useCallback(
    async (handles: string[], recordListId?: string) => {
      const uniqueHandles = [...new Set(handles)];
      const combinedResult: AddContactsData['addUniboxContactsToCrm'] = {
        createdPersonCount: 0,
        alreadyExistingCount: 0,
        personIds: [],
      };

      for (
        let batchStart = 0;
        batchStart < uniqueHandles.length;
        batchStart += UNIBOX_ADD_CONTACTS_BATCH_SIZE
      ) {
        const result = await addContactsMutation({
          variables: {
            input: {
              handles: uniqueHandles.slice(
                batchStart,
                batchStart + UNIBOX_ADD_CONTACTS_BATCH_SIZE,
              ),
              recordListId,
            },
          },
        });
        const batchResult = result.data?.addUniboxContactsToCrm;

        if (!batchResult) continue;

        combinedResult.createdPersonCount += batchResult.createdPersonCount;
        combinedResult.alreadyExistingCount += batchResult.alreadyExistingCount;
        combinedResult.personIds.push(...batchResult.personIds);
      }

      combinedResult.personIds = [...new Set(combinedResult.personIds)];

      await Promise.all([
        refetch(),
        apolloCoreClient.refetchQueries({ include: ['UniboxThreads'] }),
      ]);

      return combinedResult;
    },
    [addContactsMutation, apolloCoreClient, refetch],
  );

  return {
    contacts,
    totalCount,
    loading: loading && networkStatus !== NetworkStatus.fetchMore,
    isFetchingMore: networkStatus === NetworkStatus.fetchMore,
    isAdding,
    hasNextPage,
    fetchMoreContacts,
    fetchAllMatchingHandles,
    addContacts,
    error,
  };
};
