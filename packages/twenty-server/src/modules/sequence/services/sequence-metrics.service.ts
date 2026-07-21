import { Injectable } from '@nestjs/common';

import { SEQUENCE_ENROLLMENT_STATUSES } from 'twenty-shared/types';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
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
  }: {
    workspaceId: string;
    sequenceId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
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
      const [
        enrolledCount,
        activeCount,
        completedCount,
        repliedCount,
        failedCount,
      ] = await Promise.all([
        enrollmentRepository.count({ where: { sequenceId } }),
        enrollmentRepository.count({
          where: {
            sequenceId,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          },
        }),
        enrollmentRepository.count({
          where: {
            sequenceId,
            status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
          },
        }),
        enrollmentRepository.count({
          where: {
            sequenceId,
            status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          },
        }),
        enrollmentRepository.count({
          where: {
            sequenceId,
            status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
          },
        }),
      ]);

      await sequenceRepository.update(sequenceId, {
        enrolledCount,
        activeCount,
        completedCount,
        repliedCount,
        failedCount,
      });
    }, buildSystemAuthContext(workspaceId));
  }
}
