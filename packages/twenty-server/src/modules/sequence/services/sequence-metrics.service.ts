import { Injectable } from '@nestjs/common';

import { SEQUENCE_ENROLLMENT_STATUSES } from 'twenty-shared/types';
import { In } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

@Injectable()
export class SequenceMetricsService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async recomputeForSequence({
    workspaceId,
    sequenceId,
    enrollmentIdsToLock = [],
  }: {
    workspaceId: string;
    sequenceId: string;
    enrollmentIdsToLock?: string[];
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      () =>
        this.recomputeForSequenceInCurrentContext({
          workspaceId,
          sequenceId,
          enrollmentIdsToLock,
        }),
      buildSystemAuthContext(workspaceId),
    );
  }

  async recomputeForSequenceInCurrentContext({
    workspaceId,
    sequenceId,
    enrollmentIdsToLock = [],
  }: {
    workspaceId: string;
    sequenceId: string;
    enrollmentIdsToLock?: string[];
  }): Promise<void> {
    const workspaceDataSource =
      await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

    await workspaceDataSource.transaction(async (transactionManager) => {
      const workspaceTransactionManager =
        transactionManager as WorkspaceEntityManager;
      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const sequenceRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      // Enrollment events can be emitted before their transaction commits.
      // The admission transaction already owns this row lock, so acquiring it
      // before reading makes an early recompute wait until the new statuses
      // are visible. It also serializes concurrent recomputes so an older
      // snapshot cannot overwrite newer counters.
      const lockedSequence = await sequenceRepository.findOne(
        {
          where: { id: sequenceId },
          select: ['id'],
          // Archive finalization runs after the sequence soft-delete. Keep
          // archived counters accurate so a later restore cannot expose the
          // pre-archive ACTIVE totals.
          withDeleted: true,
          lock: { mode: 'pessimistic_write' },
        },
        workspaceTransactionManager,
      );

      if (!lockedSequence) {
        return;
      }

      // Other transactional status changes only lock their enrollment rows.
      // Waiting on the event's rows closes the same pre-commit gap for them.
      if (enrollmentIdsToLock.length > 0) {
        await enrollmentRepository.find(
          {
            where: { id: In(enrollmentIdsToLock) },
            select: ['id'],
            lock: { mode: 'pessimistic_write' },
          },
          workspaceTransactionManager,
        );
      }

      const [
        enrolledCount,
        activeCount,
        completedCount,
        repliedCount,
        failedCount,
      ] = await Promise.all([
        enrollmentRepository.count(
          { where: { sequenceId } },
          workspaceTransactionManager,
        ),
        enrollmentRepository.count(
          {
            where: {
              sequenceId,
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            },
          },
          workspaceTransactionManager,
        ),
        enrollmentRepository.count(
          {
            where: {
              sequenceId,
              status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
            },
          },
          workspaceTransactionManager,
        ),
        enrollmentRepository.count(
          {
            where: {
              sequenceId,
              status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
            },
          },
          workspaceTransactionManager,
        ),
        enrollmentRepository.count(
          {
            where: {
              sequenceId,
              status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
            },
          },
          workspaceTransactionManager,
        ),
      ]);

      await sequenceRepository.update(
        sequenceId,
        {
          enrolledCount,
          activeCount,
          completedCount,
          repliedCount,
          failedCount,
        },
        workspaceTransactionManager,
      );
    });
  }
}
