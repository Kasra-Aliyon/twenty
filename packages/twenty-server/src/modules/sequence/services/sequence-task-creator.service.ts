import { Injectable } from '@nestjs/common';

import { type SequenceCreateTaskStepSettings } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { transformRichTextValue } from 'src/engine/core-modules/record-transformer/utils/transform-rich-text.util';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { TaskTargetWorkspaceEntity } from 'src/modules/task/standard-objects/task-target.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';
import { renderSequenceTemplate } from 'src/modules/sequence/utils/render-sequence-template.util';

@Injectable()
export class SequenceTaskCreatorService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceVariableService: SequenceVariableService,
  ) {}

  async createTask({
    workspaceId,
    enrollment,
    person,
    step,
    settings,
    connectedAccountId,
    dueAt,
    entityManager,
  }: {
    workspaceId: string;
    enrollment: SequenceEnrollmentWorkspaceEntity;
    person: PersonWorkspaceEntity;
    step: SequenceStepWorkspaceEntity;
    settings: SequenceCreateTaskStepSettings;
    connectedAccountId: string | null;
    dueAt: Date | null;
    entityManager?: WorkspaceEntityManager;
  }): Promise<void> {
    const variables = await this.sequenceVariableService.buildVariables({
      workspaceId,
      person,
      connectedAccountId,
    });
    const title = renderSequenceTemplate(settings.titleTemplate, variables, {
      escapeValues: false,
    });
    const notes = renderSequenceTemplate(settings.notesTemplate, variables, {
      escapeValues: false,
    });
    const bodyV2 = await transformRichTextValue({
      markdown: notes,
      blocknote: null,
    });

    const insertTaskAndTarget = async () => {
      const taskRepository = await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        TaskWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
      const taskTargetRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          TaskTargetWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const insertResult = await taskRepository.insert(
        {
          title,
          bodyV2,
          dueAt,
          status: 'TODO',
          type: settings.taskType,
          priority: settings.priority,
          assigneeId:
            settings.assigneeWorkspaceMemberId ??
            enrollment.createdBy?.workspaceMemberId ??
            null,
          sequenceEnrollmentId: enrollment.id,
          sequenceStepId: step.id,
        },
        entityManager,
      );
      const taskId = insertResult.identifiers[0]?.id;

      if (!isDefined(taskId)) {
        throw new Error(
          `Failed to create task for sequence enrollment ${enrollment.id}`,
        );
      }

      await taskTargetRepository.insert(
        {
          taskId,
          targetPersonId: person.id,
        },
        entityManager,
      );
    };

    if (isDefined(entityManager)) {
      await insertTaskAndTarget();

      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      insertTaskAndTarget,
      buildSystemAuthContext(workspaceId),
    );
  }

  async completeOpenTasks({
    workspaceId,
    enrollmentId,
  }: {
    workspaceId: string;
    enrollmentId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const taskRepository = await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        TaskWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

      await taskRepository.update(
        {
          sequenceEnrollmentId: enrollmentId,
          status: In(['TODO', 'IN_PROGRESS']),
        },
        { status: 'DONE' },
      );
    }, buildSystemAuthContext(workspaceId));
  }
}
