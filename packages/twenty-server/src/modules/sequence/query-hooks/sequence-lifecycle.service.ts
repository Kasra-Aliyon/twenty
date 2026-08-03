import { Injectable } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';
import { In } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

const OPEN_ENROLLMENT_STATUSES = [
  SEQUENCE_ENROLLMENT_STATUSES.PENDING,
  SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
];

const OPEN_LINKEDIN_ACTION_STATUSES = [
  LINKEDIN_ACTION_STATUSES.SCHEDULED,
  LINKEDIN_ACTION_STATUSES.CLAIMED,
];

const OPEN_TASK_STATUSES = ['TODO', 'IN_PROGRESS'] as const;

@Injectable()
export class SequenceLifecycleService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceMetricsService: SequenceMetricsService,
  ) {}

  async pauseBeforeArchive({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const sequenceRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            SequenceWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        await sequenceRepository.update(
          {
            id: sequenceId,
            status: SEQUENCE_STATUSES.ACTIVE,
          },
          { status: SEQUENCE_STATUSES.PAUSED },
        );
      },
      authContext,
      { lite: true },
    );
  }

  async finalizeArchive({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const enrollmentRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            SequenceEnrollmentWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const openEnrollments = await enrollmentRepository.find({
          where: {
            sequenceId,
            status: In(OPEN_ENROLLMENT_STATUSES),
          },
          select: ['id'],
        });
        const openEnrollmentIds = openEnrollments.map(({ id }) => id);

        if (openEnrollmentIds.length === 0) {
          return;
        }

        const now = new Date();

        await enrollmentRepository.update(
          {
            id: In(openEnrollmentIds),
            status: In(OPEN_ENROLLMENT_STATUSES),
          },
          {
            status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
            waitingOn: null,
            nextActionAt: null,
            endedAt: now,
          },
        );

        const taskRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            TaskWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        await taskRepository.update(
          {
            sequenceEnrollmentId: In(openEnrollmentIds),
            status: In(OPEN_TASK_STATUSES),
          },
          { status: 'DONE' },
        );

        const linkedinActionRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            LinkedinActionWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        await linkedinActionRepository.update(
          {
            sequenceEnrollmentId: In(openEnrollmentIds),
            status: In(OPEN_LINKEDIN_ACTION_STATUSES),
          },
          {
            status: LINKEDIN_ACTION_STATUSES.CANCELLED,
            executedAt: now,
            errorMessage: 'Sequence archived',
            claimedAt: null,
            claimedBy: null,
          },
        );
      },
      authContext,
      { lite: true },
    );

    await this.sequenceMetricsService.recomputeForSequence({
      workspaceId: authContext.workspace.id,
      sequenceId,
    });
  }

  async preparePermanentDeletion({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const enrollmentRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            SequenceEnrollmentWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const stepRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            SequenceStepWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const [enrollments, steps] = await Promise.all([
          enrollmentRepository.find({
            where: { sequenceId },
            withDeleted: true,
            select: ['id'],
          }),
          stepRepository.find({
            where: { sequenceId },
            withDeleted: true,
            select: ['id'],
          }),
        ]);
        const enrollmentIds = enrollments.map(({ id }) => id);
        const stepIds = steps.map(({ id }) => id);

        const taskRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            TaskWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );
        const linkedinActionRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            authContext.workspace.id,
            LinkedinActionWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        if (enrollmentIds.length > 0) {
          await linkedinActionRepository.update(
            {
              sequenceEnrollmentId: In(enrollmentIds),
              status: In(OPEN_LINKEDIN_ACTION_STATUSES),
            },
            {
              status: LINKEDIN_ACTION_STATUSES.CANCELLED,
              executedAt: new Date(),
              errorMessage: 'Sequence permanently deleted',
              claimedAt: null,
              claimedBy: null,
            },
          );
          await taskRepository.update(
            { sequenceEnrollmentId: In(enrollmentIds) },
            { sequenceEnrollmentId: null },
          );
          await linkedinActionRepository.update(
            { sequenceEnrollmentId: In(enrollmentIds) },
            { sequenceEnrollmentId: null },
          );
        }

        if (stepIds.length > 0) {
          await taskRepository.update(
            { sequenceStepId: In(stepIds) },
            { sequenceStepId: null },
          );
          await linkedinActionRepository.update(
            { sequenceStepId: In(stepIds) },
            { sequenceStepId: null },
          );
        }
      },
      authContext,
      { lite: true },
    );
  }
}
