import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
} from 'twenty-shared/types';
import { In } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { type LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';

const SEQUENCE_LINKEDIN_ACTION_SUPERSEDED_BY_MANUAL_ERROR =
  'Superseded by a completed manual LinkedIn invitation action';

export const reconcileManualLinkedinInvitationActionConflicts = async ({
  actionRepository,
  ownerWorkspaceMemberId,
  personId,
  transactionManager,
}: {
  actionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
  ownerWorkspaceMemberId: string;
  personId: string;
  transactionManager: WorkspaceEntityManager;
}): Promise<boolean> => {
  const conflictingActions = await actionRepository.find(
    {
      where: {
        personId,
        ownerWorkspaceMemberId,
        type: In([
          LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
          LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
        ]),
        status: In([
          LINKEDIN_ACTION_STATUSES.SCHEDULED,
          LINKEDIN_ACTION_STATUSES.CLAIMED,
        ]),
      },
      select: ['id', 'status'],
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    },
    transactionManager,
  );

  // A claimed action may already own a provider mutation. Leave the task
  // waiting until the runner publishes a terminal outcome.
  if (
    conflictingActions.some(
      ({ status }) => status === LINKEDIN_ACTION_STATUSES.CLAIMED,
    )
  ) {
    return false;
  }

  for (const conflictingAction of conflictingActions) {
    const cancellationResult = await actionRepository.update(
      {
        id: conflictingAction.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
      {
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
        connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_SUPERSEDED_BY_MANUAL_ERROR,
      },
      transactionManager,
    );

    if (cancellationResult.affected !== 1) {
      throw new Error(
        `Could not cancel conflicting LinkedIn action ${conflictingAction.id}`,
      );
    }
  }

  return true;
};
