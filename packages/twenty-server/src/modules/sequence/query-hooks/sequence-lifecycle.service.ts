import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR } from 'src/modules/sequence/sequence.constants';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';
import { hasLiveSequenceEmailSendLease } from 'src/modules/sequence/utils/has-live-sequence-email-send-lease.util';

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
        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        await workspaceDataSource.transaction((transactionManager) =>
          this.pauseBeforeArchiveInTransaction({
            authContext,
            sequenceId,
            workspaceEntityManager:
              transactionManager as WorkspaceEntityManager,
          }),
        );
      },
      authContext,
      { lite: true },
    );
  }

  async pauseBeforeArchiveInTransaction({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
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
      workspaceEntityManager,
    );
  }

  // Pausing must actually stop outreach. An enrollment waiting on a LinkedIn
  // action has already handed a queued invitation, message, or withdrawal to
  // the browser runner, and that queue is not gated on sequence status: without
  // this, "pause" keeps sending for as long as those actions stay scheduled -
  // up to the configured withdrawal delay.
  async quiesceOnPause({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        await workspaceDataSource.transaction((transactionManager) =>
          this.quiesceOnPauseInTransaction({
            authContext,
            sequenceId,
            workspaceEntityManager:
              transactionManager as WorkspaceEntityManager,
          }),
        );
      },
      authContext,
      { lite: true },
    );
  }

  async quiesceOnPauseInTransaction({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const enrollmentRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        SequenceEnrollmentWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const linkedinActionRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        LinkedinActionWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const pausedSequence = await sequenceRepository.findOne(
      {
        where: {
          id: sequenceId,
          status: SEQUENCE_STATUSES.PAUSED,
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (!isDefined(pausedSequence)) {
      return;
    }

    const now = new Date();

    // Apollo claims that have not crossed the provider boundary are safe to
    // release. Provider-started waits remain intact so a paid request can still
    // be completed by its webhook without a duplicate reveal on resume.
    await enrollmentRepository.update(
      {
        sequenceId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: In([
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
          SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
        ]),
      },
      {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: now,
      },
      workspaceEntityManager,
    );

    const waitingEnrollments = await enrollmentRepository.find(
      {
        where: {
          sequenceId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        },
        select: ['id'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (waitingEnrollments.length === 0) {
      return;
    }

    // A claimed action is already executing inside the browser runner. Only
    // rows still SCHEDULED after both sides contend for the row lock are
    // cancelled; claimed work keeps its runner-owned outcome.
    const scheduledActions = await linkedinActionRepository.find(
      {
        where: {
          sequenceEnrollmentId: In(waitingEnrollments.map(({ id }) => id)),
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        },
        select: ['id', 'sequenceEnrollmentId'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (scheduledActions.length === 0) {
      return;
    }

    const releasedEnrollmentIds = new Set<string>();

    for (const action of scheduledActions) {
      if (!isDefined(action.sequenceEnrollmentId)) {
        continue;
      }

      const cancellationResult = await linkedinActionRepository.update(
        {
          id: action.id,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        },
        {
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          executedAt: now,
          errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
        },
        workspaceEntityManager,
      );

      if (cancellationResult.affected !== 1) {
        throw new Error(
          `Failed to cancel LinkedIn action ${action.id} while pausing sequence ${sequenceId}`,
        );
      }

      releasedEnrollmentIds.add(action.sequenceEnrollmentId);
    }

    for (const enrollmentId of releasedEnrollmentIds) {
      const releaseResult = await enrollmentRepository.update(
        {
          id: enrollmentId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        },
        {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: now,
        },
        workspaceEntityManager,
      );

      if (releaseResult.affected !== 1) {
        throw new Error(
          `Failed to release sequence enrollment ${enrollmentId} after cancelling its LinkedIn action`,
        );
      }
    }
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
        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        await workspaceDataSource.transaction((transactionManager) =>
          this.finalizeArchiveInTransaction({
            authContext,
            sequenceId,
            workspaceEntityManager:
              transactionManager as WorkspaceEntityManager,
          }),
        );
      },
      authContext,
      { lite: true },
    );

    await this.recomputeMetricsAfterArchive({ authContext, sequenceId });
  }

  async finalizeArchiveInTransaction({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const archivedSequence = await sequenceRepository.findOne(
      {
        where: { id: sequenceId },
        withDeleted: true,
        select: ['id', 'deletedAt'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (!isDefined(archivedSequence?.deletedAt)) {
      return;
    }

    const enrollmentRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        SequenceEnrollmentWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const openEnrollments = await enrollmentRepository.find(
      {
        where: {
          sequenceId,
          status: In(OPEN_ENROLLMENT_STATUSES),
        },
        select: ['id'],
      },
      workspaceEntityManager,
    );
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
      workspaceEntityManager,
    );

    const taskRepository = await this.globalWorkspaceOrmManager.getRepository(
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
      workspaceEntityManager,
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
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      },
      {
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        executedAt: now,
        errorMessage: 'Sequence archived',
        claimedAt: null,
        claimedBy: null,
      },
      workspaceEntityManager,
    );
  }

  async recomputeMetricsAfterArchive({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
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
        const workspaceDataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        await workspaceDataSource.transaction((transactionManager) =>
          this.preparePermanentDeletionInTransaction({
            authContext,
            sequenceId,
            workspaceEntityManager:
              transactionManager as WorkspaceEntityManager,
          }),
        );
      },
      authContext,
      { lite: true },
    );
  }

  async preparePermanentDeletionInTransaction({
    authContext,
    sequenceId,
    workspaceEntityManager,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    workspaceEntityManager: WorkspaceEntityManager;
  }): Promise<void> {
    const sequenceRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        SequenceWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const enrollmentRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        SequenceEnrollmentWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const stepRepository = await this.globalWorkspaceOrmManager.getRepository(
      authContext.workspace.id,
      SequenceStepWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const taskRepository = await this.globalWorkspaceOrmManager.getRepository(
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
    const sequence = await sequenceRepository.findOne(
      {
        where: { id: sequenceId },
        withDeleted: true,
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    if (!isDefined(sequence)) {
      return;
    }

    // Match the runner's sequence -> enrollment -> action lock order. Once
    // these rows are held, a scheduled action either became CLAIMED first (and
    // deletion is rejected) or is cancelled before a runner can acquire it.
    const enrollments = await enrollmentRepository.find(
      {
        where: { sequenceId: sequence.id },
        withDeleted: true,
        select: ['id', 'lastSendAttempt', 'nextActionAt', 'sentEmailsByStepId'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );

    const now = new Date();
    const hasLiveUnresolvedEmailSend = enrollments.some((enrollment) =>
      hasLiveSequenceEmailSendLease({ enrollment, now }),
    );

    if (hasLiveUnresolvedEmailSend) {
      throw new CommonQueryRunnerException(
        'Wait for in-flight sequence emails to finish before permanently deleting the sequence',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`This sequence cannot be permanently deleted while an email is being sent.`,
        },
      );
    }

    const steps = await stepRepository.find(
      {
        where: { sequenceId: sequence.id },
        withDeleted: true,
        select: ['id'],
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      },
      workspaceEntityManager,
    );
    const enrollmentIds = enrollments.map(({ id }) => id);
    const stepIds = steps.map(({ id }) => id);
    const actionScopes = [
      ...(enrollmentIds.length > 0
        ? [
            {
              sequenceEnrollmentId: In(enrollmentIds),
              status: In(OPEN_LINKEDIN_ACTION_STATUSES),
            },
          ]
        : []),
      ...(stepIds.length > 0
        ? [
            {
              sequenceStepId: In(stepIds),
              status: In(OPEN_LINKEDIN_ACTION_STATUSES),
            },
          ]
        : []),
    ];
    const openActions =
      actionScopes.length > 0
        ? await linkedinActionRepository.find(
            {
              where: actionScopes,
              select: ['id', 'status'],
              order: { id: 'ASC' },
              lock: { mode: 'pessimistic_write' },
            },
            workspaceEntityManager,
          )
        : [];

    if (
      openActions.some(
        ({ status }) => status === LINKEDIN_ACTION_STATUSES.CLAIMED,
      )
    ) {
      throw new CommonQueryRunnerException(
        'Wait for in-flight LinkedIn actions to finish before permanently deleting the sequence',
        CommonQueryRunnerExceptionCode.BAD_REQUEST,
        {
          userFriendlyMessage: msg`This sequence cannot be permanently deleted while a LinkedIn action is running.`,
        },
      );
    }

    const scheduledActionIds = openActions
      .filter(({ status }) => status === LINKEDIN_ACTION_STATUSES.SCHEDULED)
      .map(({ id }) => id);

    if (scheduledActionIds.length > 0) {
      await linkedinActionRepository.update(
        {
          id: In(scheduledActionIds),
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        },
        {
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          executedAt: new Date(),
          errorMessage: 'Sequence permanently deleted',
          claimedAt: null,
          claimedBy: null,
        },
        workspaceEntityManager,
      );
    }

    if (enrollmentIds.length > 0) {
      await taskRepository.update(
        { sequenceEnrollmentId: In(enrollmentIds) },
        { sequenceEnrollmentId: null },
        workspaceEntityManager,
      );
    }

    if (stepIds.length > 0) {
      await taskRepository.update(
        { sequenceStepId: In(stepIds) },
        { sequenceStepId: null },
        workspaceEntityManager,
      );
    }
  }
}
