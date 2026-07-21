import type {
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
  linkedinUrl
  noteText
  connectionState
  attemptCount
  errorMessage
`;

const FETCH_DUE_ACTIONS = `
  query FetchDueLinkedinActions($filter: LinkedinActionFilterInput!) {
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

const CLAIM_ACTION = `
  mutation ClaimLinkedinAction(
    $filter: LinkedinActionFilterInput!
    $data: LinkedinActionUpdateInput!
  ) {
    updateLinkedinActions(filter: $filter, data: $data) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

const REPORT_ACTION = `
  mutation ReportLinkedinAction(
    $id: UUID!
    $data: LinkedinActionUpdateInput!
  ) {
    updateLinkedinAction(id: $id, data: $data) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

type LinkedinActionsQueryResult = {
  linkedinActions: {
    edges: Array<{ node: TwentyLinkedInAction }>;
  };
};

export const fetchDueActions = async (
  client: TwentyApiClient,
  now = new Date(),
): Promise<TwentyLinkedInAction[]> => {
  const result = await client.graphqlRequest<LinkedinActionsQueryResult>(
    FETCH_DUE_ACTIONS,
    {
      filter: {
        status: { eq: 'SCHEDULED' },
        scheduledAt: { lte: now.toISOString() },
      },
    },
  );

  return result.data?.linkedinActions.edges.map(({ node }) => node) ?? [];
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

export const claimAction = async (
  client: TwentyApiClient,
  id: string,
  claimedBy: string,
): Promise<TwentyLinkedInAction | null> => {
  const result = await client.graphqlRequest<{
    updateLinkedinActions: TwentyLinkedInAction[];
  }>(CLAIM_ACTION, {
    filter: {
      id: { eq: id },
      status: { eq: 'SCHEDULED' },
      scheduledAt: { lte: new Date().toISOString() },
    },
    data: {
      status: 'CLAIMED',
      claimedAt: new Date().toISOString(),
      claimedBy,
    },
  });

  return result.data?.updateLinkedinActions[0] ?? null;
};

export const reportAction = async (
  client: TwentyApiClient,
  id: string,
  report: {
    status: Extract<LinkedInActionStatus, 'COMPLETED' | 'SKIPPED' | 'FAILED'>;
    connectionState: LinkedInConnectionState;
    errorMessage?: string | null;
  },
): Promise<TwentyLinkedInAction> => {
  const result = await client.graphqlRequest<{
    updateLinkedinAction: TwentyLinkedInAction;
  }>(REPORT_ACTION, {
    id,
    data: {
      status: report.status,
      connectionState: report.connectionState,
      errorMessage: report.errorMessage ?? null,
      executedAt: new Date().toISOString(),
    },
  });

  if (!result.data?.updateLinkedinAction) {
    throw new Error('Failed to report LinkedIn action');
  }

  return result.data.updateLinkedinAction;
};
