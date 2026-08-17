import { Injectable, NotFoundException } from '@nestjs/common';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type SequenceAnalyticsDTO } from 'src/modules/sequence/dtos/sequence-analytics.dto';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { buildSequenceAnalytics } from 'src/modules/sequence/utils/build-sequence-analytics.util';

@Injectable()
export class SequenceAnalyticsService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async getForSequence({
    workspaceId,
    sequenceId,
  }: {
    workspaceId: string;
    sequenceId: string;
  }): Promise<SequenceAnalyticsDTO> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const sequenceRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceWorkspaceEntity,
          );
        const enrollmentRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceEnrollmentWorkspaceEntity,
          );
        const stepRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            SequenceStepWorkspaceEntity,
          );
        const sequence = await sequenceRepository.findOne({
          where: { id: sequenceId },
          select: { id: true },
          withDeleted: true,
        });

        if (sequence === null) {
          throw new NotFoundException('Sequence not found.');
        }

        const [enrollments, steps] = await Promise.all([
          enrollmentRepository.find({
            where: { sequenceId },
            select: {
              status: true,
              sentEmailsByStepId: true,
            },
          }),
          stepRepository.find({
            where: { sequenceId },
            select: {
              id: true,
              name: true,
              position: true,
              settings: true,
            },
            order: { position: 'ASC' },
          }),
        ]);

        return buildSequenceAnalytics({ enrollments, steps });
      },
    );
  }
}
