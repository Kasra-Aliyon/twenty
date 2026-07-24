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
  sequenceStepId
`;

const FETCH_SEQUENCE_STEP_SETTINGS = `
  query FetchLinkedinActionSequenceSteps($filter: SequenceStepFilterInput!) {
    sequenceSteps(filter: $filter, first: 100) {
      edges {
        node {
          id
          settings
        }
      }
    }
  }
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
    $filter: LinkedinActionFilterInput!
    $data: LinkedinActionUpdateInput!
  ) {
    updateLinkedinActions(filter: $filter, data: $data) {
      ${LINKEDIN_ACTION_FIELDS}
    }
  }
`;

type LinkedinActionsQueryResult = {
  linkedinActions: {
    edges: Array<{ node: TwentyLinkedInAction }>;
  };
};

export const applySkipIfAlreadyConnectedSettings = (
  actions: TwentyLinkedInAction[],
  skipSettingByStepId: ReadonlyMap<string, boolean>,
): TwentyLinkedInAction[] =>
  actions.map((action) => ({
    ...action,
    skipIfAlreadyConnected:
      (action.sequenceStepId
        ? skipSettingByStepId.get(action.sequenceStepId)
        : undefined) ?? true,
  }));

const hydrateSkipIfAlreadyConnected = async (
  client: TwentyApiClient,
  actions: TwentyLinkedInAction[],
): Promise<TwentyLinkedInAction[]> => {
  const sequenceStepIds = [
    ...new Set(
      actions
        .filter(({ type }) => type === 'SEND_CONNECTION_REQUEST')
        .map(({ sequenceStepId }) => sequenceStepId)
        .filter((sequenceStepId): sequenceStepId is string =>
          Boolean(sequenceStepId),
        ),
    ),
  ];

  if (sequenceStepIds.length === 0) {
    return applySkipIfAlreadyConnectedSettings(actions, new Map());
  }

  const result = await client.graphqlRequest<{
    sequenceSteps: {
      edges: Array<{
        node: {
          id: string;
          settings: { skipIfAlreadyConnected?: boolean };
        };
      }>;
    };
  }>(FETCH_SEQUENCE_STEP_SETTINGS, {
    filter: { id: { in: sequenceStepIds } },
  });
  const skipSettingByStepId = new Map(
    (result.data?.sequenceSteps.edges ?? []).map(({ node }) => [
      node.id,
      node.settings.skipIfAlreadyConnected !== false,
    ]),
  );

  return applySkipIfAlreadyConnectedSettings(actions, skipSettingByStepId);
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

  return hydrateSkipIfAlreadyConnected(
    client,
    result.data?.linkedinActions.edges.map(({ node }) => node) ?? [],
  );
};

export const fetchLinkedinActionQueue = async (
  client: TwentyApiClient,
): Promise<TwentyLinkedInAction[]> => {
  const result = await client.graphqlRequest<LinkedinActionsQueryResult>(
    FETCH_ACTION_QUEUE,
    { filter: { status: { eq: 'SCHEDULED' } } },
  );

  return hydrateSkipIfAlreadyConnected(
    client,
    result.data?.linkedinActions.edges.map(({ node }) => node) ?? [],
  );
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

  const action = result.data?.updateLinkedinActions[0];

  if (!action) {
    return null;
  }

  return (await hydrateSkipIfAlreadyConnected(client, [action]))[0] ?? null;
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
): Promise<TwentyLinkedInAction> => {
  const result = await client.graphqlRequest<{
    updateLinkedinActions: TwentyLinkedInAction[];
  }>(REPORT_ACTION, {
    filter: {
      id: { eq: id },
      status: { eq: 'CLAIMED' },
      claimedBy: { eq: claimedBy },
      claimedAt: { eq: claimedAt },
    },
    data: {
      status: report.status,
      connectionState: report.connectionState,
      errorMessage: report.errorMessage ?? null,
      executedAt: new Date().toISOString(),
    },
  });
  const action = result.data?.updateLinkedinActions[0];

  if (!action) {
    throw new Error('The LinkedIn action is no longer claimed by this runner');
  }

  return action;
};
