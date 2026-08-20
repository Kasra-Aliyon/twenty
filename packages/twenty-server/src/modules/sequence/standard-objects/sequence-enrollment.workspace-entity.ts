import {
  type ActorMetadata,
  type SequenceEnrollmentStatus,
  type SequenceWaitingOn,
} from 'twenty-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

export type SequenceSentEmailMetadata = {
  headerMessageId: string;
  threadExternalId: string;
  sentAt: string;
  connectedAccountId?: string;
  stopOnReply?: boolean;
  variantId?: string;
  variantName?: string;
  repliedAt?: string;
};

export type SequenceLastSendAttempt = {
  stepId: string;
  attemptedAt: string;
  dailyReservation?: {
    mailboxId: string;
    token: string;
    usageDate: string;
  };
  preProviderFailure?: {
    attemptCount: number;
    errorMessage: string;
    failedAt: string;
  };
  reservationReleasePendingAt?: string;
  providerStartedAt?: string;
  deliveredEmail?: {
    stepPosition: number;
    metadata: SequenceSentEmailMetadata;
  };
  previousCursor?: {
    currentStepId: string | null;
    currentStepPosition: number;
    waitingOn: SequenceWaitingOn | null;
    nextActionAt: string | null;
    stopOnReply: boolean;
  };
};

export class SequenceEnrollmentWorkspaceEntity extends BaseWorkspaceEntity {
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  sequence: EntityRelation<SequenceWorkspaceEntity>;
  sequenceId: string;
  person: EntityRelation<PersonWorkspaceEntity>;
  personId: string;
  status: SequenceEnrollmentStatus;
  currentStepId: string | null;
  currentStepPosition: number;
  waitingOn: SequenceWaitingOn | null;
  nextActionAt: Date | null;
  senderConnectedAccountId: string | null;
  stopOnReply: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  errorMessage: string | null;
  sentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
  lastSendAttempt: SequenceLastSendAttempt | null;
  position: number;
  searchVector: string;
}
