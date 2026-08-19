import type {
  GraphQLResponse,
  LinkedInActionStatus,
  LinkedInConnectionState,
  TwentyLinkedInAction,
} from '../types';
import { TwentyApiClient } from './twenty-api';

const LINKEDIN_ACTION_FIELDS = `
  id
  type
  status
  scheduledAt
  claimedAt
  claimedBy
  executedAt
  linkedinUrl
  noteText
`;

const FETCH_DUE_ACTIONS = `
  query FetchDueLinkedinActions(
    $filter: LinkedinActionFilterInput!
    $after: String
  ) {
    linkedinActions(
      filter: $filter
      orderBy: [{ scheduledAt: AscNullsLast }]
      first: 100
      after: $after
    ) {
      edges {
        node {
          ${LINKEDIN_ACTION_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const FETCH_ACTION_QUEUE = `
  query FetchLinkedinActionQueue($filter: LinkedinActionFilterInput!) {
    linkedinActions(
      filter: $filter
      orderBy: [{ scheduledAt: AscNullsLast }]
      first: 100
    ) {
      edges {
        node {
          ${LINKEDIN_ACTION_FIELDS}
        }
      }
    }
  }
`;

const FETCH_ACTION_BY_ID = `
  query FetchLinkedinActionForReconciliation(
    $filter: LinkedinActionFilterInput!
  ) {
    linkedinActions(filter: $filter, first: 1) {
      edges {
        node {
          ${LINKEDIN_ACTION_FIELDS}
        }
      }
    }
  }
`;

const CLAIM_ACTION = `
  mutation ClaimLinkedinAction(
    $actionId: UUID!
    $claimedBy: String!
  ) {
    claimSequenceLinkedinAction(actionId: $actionId, claimedBy: $claimedBy) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

const START_ACTION = `
  mutation StartSequenceLinkedinAction(
    $actionId: UUID!
    $claimedBy: String!
    $claimedAt: DateTime!
  ) {
    startSequenceLinkedinAction(
      actionId: $actionId
      claimedBy: $claimedBy
      claimedAt: $claimedAt
    ) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

const REPORT_ACTION = `
  mutation ReportSequenceLinkedinAction(
    $actionId: UUID!
    $claimedBy: String!
    $claimedAt: DateTime!
    $data: SequenceLinkedinActionReportInput!
  ) {
    reportSequenceLinkedinAction(
      actionId: $actionId
      claimedBy: $claimedBy
      claimedAt: $claimedAt
      data: $data
    ) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

const RELEASE_ACTION_CLAIM = `
  mutation ReleaseSequenceLinkedinActionClaim(
    $actionId: UUID!
    $claimedBy: String!
    $claimedAt: DateTime!
  ) {
    releaseSequenceLinkedinActionClaim(
      actionId: $actionId
      claimedBy: $claimedBy
      claimedAt: $claimedAt
    ) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

type LinkedinActionsQueryResult = {
  linkedinActions: {
    edges: Array<{ node: TwentyLinkedInAction }>;
    pageInfo?: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

export const fetchDueActions = async (
  client: TwentyApiClient,
  now = new Date(),
): Promise<TwentyLinkedInAction[]> => {
  const actions: TwentyLinkedInAction[] = [];
  let after: string | null = null;

  do {
    const result: GraphQLResponse<LinkedinActionsQueryResult> =
      await client.graphqlRequest<LinkedinActionsQueryResult>(
        FETCH_DUE_ACTIONS,
        {
          filter: {
            status: { eq: 'SCHEDULED' },
            scheduledAt: { lte: now.toISOString() },
          },
          after,
        },
      );
    const connection = result.data?.linkedinActions;

    actions.push(...(connection?.edges.map(({ node }) => node) ?? []));
    after =
      connection?.pageInfo?.hasNextPage === true
        ? (connection.pageInfo.endCursor ?? null)
        : null;
  } while (after !== null);

  return actions;
};

export const fetchLinkedinActionQueue = async (
  client: TwentyApiClient,
): Promise<TwentyLinkedInAction[]> => {
  const result = await client.graphqlRequest<LinkedinActionsQueryResult>(
    FETCH_ACTION_QUEUE,
    { filter: { status: { eq: 'SCHEDULED' } } },
  );

  return result.data?.linkedinActions.edges.map(({ node }) => node) ?? [];
};

export const fetchLinkedinActionById = async (
  client: TwentyApiClient,
  id: string,
): Promise<TwentyLinkedInAction | null> => {
  const result = await client.graphqlRequest<LinkedinActionsQueryResult>(
    FETCH_ACTION_BY_ID,
    { filter: { id: { eq: id } } },
  );

  return result.data?.linkedinActions.edges[0]?.node ?? null;
};

export const claimAction = async (
  client: TwentyApiClient,
  id: string,
  claimedBy: string,
): Promise<TwentyLinkedInAction | null> => {
  const result = await client.metadataRequest<{
    claimSequenceLinkedinAction: TwentyLinkedInAction | null;
  }>(CLAIM_ACTION, {
    actionId: id,
    claimedBy,
  });

  const action = result.data?.claimSequenceLinkedinAction;

  if (!action) {
    return null;
  }

  return action;
};

export const startActionClaim = async (
  client: TwentyApiClient,
  id: string,
  claimedBy: string,
  claimedAt: string,
): Promise<TwentyLinkedInAction | null> => {
  const result = await client.metadataRequest<{
    startSequenceLinkedinAction: TwentyLinkedInAction | null;
  }>(START_ACTION, {
    actionId: id,
    claimedBy,
    claimedAt,
  });

  return result.data?.startSequenceLinkedinAction ?? null;
};

export const reportAction = async (
  client: TwentyApiClient,
  id: string,
  claimedBy: string,
  claimedAt: string,
  report: {
    status: Extract<LinkedInActionStatus, 'COMPLETED' | 'SKIPPED' | 'FAILED'>;
    connectionState: LinkedInConnectionState;
    errorMessage?: string | null;
  },
): Promise<TwentyLinkedInAction | null> => {
  const result = await client.metadataRequest<{
    reportSequenceLinkedinAction: TwentyLinkedInAction | null;
  }>(REPORT_ACTION, {
    actionId: id,
    claimedBy,
    claimedAt,
    data: {
      status: report.status,
      connectionState: report.connectionState,
      errorMessage: report.errorMessage ?? null,
    },
  });
  const action = result.data?.reportSequenceLinkedinAction;

  return action ?? null;
};

export const releaseActionClaim = async (
  client: TwentyApiClient,
  id: string,
  claimedBy: string,
  claimedAt: string,
): Promise<TwentyLinkedInAction | null> => {
  const result = await client.metadataRequest<{
    releaseSequenceLinkedinActionClaim: TwentyLinkedInAction | null;
  }>(RELEASE_ACTION_CLAIM, {
    actionId: id,
    claimedBy,
    claimedAt,
  });

  return result.data?.releaseSequenceLinkedinActionClaim ?? null;
};
