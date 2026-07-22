import { NetworkStatus } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { ADD_UNIBOX_CONTACTS_TO_CRM } from '@/unibox/graphql/mutations/addUniboxContactsToCrm';
import { UNIBOX_CONTACTS } from '@/unibox/graphql/queries/uniboxContacts';
import {
  type UniboxContact,
  type UniboxContactCrmFilter,
  type UniboxContactSince,
} from '@/unibox/types/UniboxThread';

const UNIBOX_CONTACTS_PAGE_SIZE = 30;
const UNIBOX_ADD_CONTACTS_BATCH_SIZE = 1_000;

type UniboxContactsData = {
  uniboxContacts: { totalCount: number; contacts: UniboxContact[] };
};

type UniboxContactsVariables = {
  input: {
    search?: string;
    since: UniboxContactSince;
    inCrmFilter: UniboxContactCrmFilter;
    afterLastContactedAt?: string;
    afterHandle?: string;
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
  input: {
    handles?: string[];
    filter?: UniboxContactsVariables['input'];
    excludedHandles?: string[];
    recordListId?: string;
  };
};

type AddContactsSelection =
  | { handles: string[]; filter?: never; excludedHandles?: never }
  | {
      handles?: never;
      filter: UniboxContactsVariables['input'];
      excludedHandles: string[];
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
  const queryKey = JSON.stringify(variables.input);
  const [isEndReached, setIsEndReached] = useState(false);

  useEffect(() => {
    setIsEndReached(false);
  }, [queryKey]);
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
  const hasNextPage = !isEndReached && contacts.length < totalCount;

  const fetchMoreContacts = async () => {
    if (!hasNextPage || networkStatus === NetworkStatus.fetchMore) return;

    const lastContact = contacts.at(-1);

    if (!lastContact) return;

    const result = await fetchMore({
      variables: {
        input: {
          ...variables.input,
          afterLastContactedAt: lastContact.lastContactedAt,
          afterHandle: lastContact.handle,
        },
      },
      updateQuery: (previousData, { fetchMoreResult }) => ({
        uniboxContacts: {
          ...fetchMoreResult.uniboxContacts,
          totalCount: previousData.uniboxContacts.totalCount,
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

    setIsEndReached(
      (result.data?.uniboxContacts.contacts.length ?? 0) <
        UNIBOX_CONTACTS_PAGE_SIZE,
    );
  };

  const addContacts = useCallback(
    async (selection: AddContactsSelection, recordListId?: string) => {
      const combinedResult: AddContactsData['addUniboxContactsToCrm'] = {
        createdPersonCount: 0,
        alreadyExistingCount: 0,
        personIds: [],
      };

      if (selection.filter) {
        const result = await addContactsMutation({
          variables: {
            input: {
              filter: selection.filter,
              excludedHandles: selection.excludedHandles,
              recordListId,
            },
          },
        });

        Object.assign(
          combinedResult,
          result.data?.addUniboxContactsToCrm ?? combinedResult,
        );
      } else {
        const uniqueHandles = [...new Set(selection.handles)];

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
          combinedResult.alreadyExistingCount +=
            batchResult.alreadyExistingCount;
          combinedResult.personIds.push(...batchResult.personIds);
        }
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
    addContacts,
    contactFilter: variables.input,
    error,
  };
};
