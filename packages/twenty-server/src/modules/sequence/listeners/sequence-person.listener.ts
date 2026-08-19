import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { In, IsNull } from 'typeorm';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

@Injectable()
export class SequencePersonListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceQueueService: SequenceQueueService,
  ) {}

  @OnDatabaseBatchEvent('person', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<PersonWorkspaceEntity>
    >,
  ): Promise<void> {
    const candidatePersonIds = [
      ...new Set(
        payload.events
          .filter(
            ({ properties }) =>
              objectRecordChangedProperties(
                properties.before,
                properties.after,
              ).includes('phones') &&
              isNonEmptyString(
                properties.after.phones?.primaryPhoneNumber?.trim(),
              ),
          )
          .map(({ recordId }) => recordId),
      ),
    ];

    if (candidatePersonIds.length === 0) {
      return;
    }

    // Workspace update events precede their source transaction commit. Lock
    // and reread the people so a rolled-back webhook cannot release a wait and
    // a committed webhook cannot race ahead of the enrollment transition.
    const enrollmentIds =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const workspaceDataSource =
            await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              payload.workspaceId,
              PersonWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const enrollmentRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              payload.workspaceId,
              SequenceEnrollmentWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );

          return workspaceDataSource.transaction(async (transactionManager) => {
            const workspaceTransactionManager =
              transactionManager as WorkspaceEntityManager;
            const committedPeople = await personRepository.find(
              {
                where: { id: In(candidatePersonIds) },
                select: ['id', 'phones'],
                lock: { mode: 'pessimistic_write' },
              },
              workspaceTransactionManager,
            );
            const peopleWithPhoneIds = committedPeople
              .filter(({ phones }) =>
                isNonEmptyString(phones?.primaryPhoneNumber?.trim()),
              )
              .map(({ id }) => id);

            if (peopleWithPhoneIds.length === 0) {
              return [];
            }

            const waitingEnrollments = await enrollmentRepository.find(
              {
                where: {
                  personId: In(peopleWithPhoneIds),
                  status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                  waitingOn: In([
                    SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
                    SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
                    SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
                  ]),
                },
                select: ['id', 'personId', 'waitingOn'],
              },
              workspaceTransactionManager,
            );
            const now = new Date();
            const awakenedEnrollmentIds: string[] = [];

            for (const enrollment of waitingEnrollments) {
              const updateResult = await enrollmentRepository.update(
                {
                  id: enrollment.id,
                  personId: enrollment.personId,
                  status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
                  waitingOn: enrollment.waitingOn ?? IsNull(),
                },
                {
                  waitingOn: SEQUENCE_WAITING_ON.DELAY,
                  nextActionAt: now,
                },
                workspaceTransactionManager,
              );

              if (updateResult.affected === 1) {
                awakenedEnrollmentIds.push(enrollment.id);
              }
            }

            return awakenedEnrollmentIds;
          });
        },
        buildSystemAuthContext(payload.workspaceId),
      );

    for (const enrollmentId of enrollmentIds) {
      await this.sequenceQueueService.enqueueProcess({
        workspaceId: payload.workspaceId,
        enrollmentId,
      });
    }
  }
}
