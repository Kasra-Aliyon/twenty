import {
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
  type SequenceCreateTaskStepSettings,
} from 'twenty-shared/types';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { type SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { TaskTargetWorkspaceEntity } from 'src/modules/task/standard-objects/task-target.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

jest.mock(
  'src/engine/core-modules/record-transformer/utils/transform-rich-text.util',
  () => ({
    transformRichTextValue: jest.fn().mockResolvedValue({
      markdown: 'Task notes',
      blocknote: null,
    }),
  }),
);

describe('SequenceTaskCreatorService assignee integrity', () => {
  const workspaceId = 'workspace-id';
  const transactionManager = {} as WorkspaceEntityManager;
  const person = { id: 'person-id' } as PersonWorkspaceEntity;
  const step = { id: 'step-id' } as SequenceStepWorkspaceEntity;
  const baseSettings: SequenceCreateTaskStepSettings = {
    type: SEQUENCE_STEP_TYPES.CREATE_TASK,
    taskType: SEQUENCE_TASK_TYPES.TODO,
    titleTemplate: 'Follow up',
    notesTemplate: 'Task notes',
    priority: TASK_PRIORITIES.MEDIUM,
    assigneeWorkspaceMemberId: 'removed-assignee-id',
    continueMode: 'ON_DONE',
    deadlineDays: null,
  };

  const createService = ({
    activeWorkspaceMemberIds,
  }: {
    activeWorkspaceMemberIds: string[];
  }) => {
    const workspaceMemberRepository = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
        activeWorkspaceMemberIds.includes(where.id) ? { id: where.id } : null,
      ),
    };
    const taskRepository = {
      insert: jest.fn(async ({ assigneeId }: { assigneeId: string | null }) => {
        if (
          assigneeId !== null &&
          !activeWorkspaceMemberIds.includes(assigneeId)
        ) {
          throw new Error('task assignee foreign key violation');
        }

        return { identifiers: [{ id: 'task-id' }] };
      }),
    };
    const taskTargetRepository = { insert: jest.fn() };
    const repositories = new Map<object, object>([
      [WorkspaceMemberWorkspaceEntity, workspaceMemberRepository],
      [TaskWorkspaceEntity, taskRepository],
      [TaskTargetWorkspaceEntity, taskTargetRepository],
    ]);
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(async (_workspaceId, entity) =>
        repositories.get(entity),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const sequenceVariableService = {
      buildVariables: jest.fn().mockResolvedValue({}),
    } as unknown as SequenceVariableService;

    return {
      service: new SequenceTaskCreatorService(
        globalWorkspaceOrmManager,
        sequenceVariableService,
      ),
      taskRepository,
      workspaceMemberRepository,
    };
  };

  it('falls back to the active enrollment creator when the configured assignee was removed', async () => {
    const { service, taskRepository, workspaceMemberRepository } =
      createService({ activeWorkspaceMemberIds: ['creator-id'] });
    const enrollment = {
      id: 'enrollment-id',
      createdBy: { workspaceMemberId: 'creator-id' },
    } as SequenceEnrollmentWorkspaceEntity;

    await expect(
      service.createTask({
        workspaceId,
        enrollment,
        person,
        step,
        settings: baseSettings,
        connectedAccountId: null,
        dueAt: null,
        entityManager: transactionManager,
      }),
    ).resolves.toBeUndefined();

    expect(workspaceMemberRepository.findOne).toHaveBeenNthCalledWith(
      1,
      {
        where: { id: 'removed-assignee-id' },
        select: ['id'],
        lock: { mode: 'pessimistic_read' },
      },
      transactionManager,
    );
    expect(workspaceMemberRepository.findOne).toHaveBeenNthCalledWith(
      2,
      {
        where: { id: 'creator-id' },
        select: ['id'],
        lock: { mode: 'pessimistic_read' },
      },
      transactionManager,
    );
    expect(taskRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'creator-id' }),
      transactionManager,
    );
  });

  it('creates an unassigned task when both configured assignee and enrollment creator are inactive', async () => {
    const { service, taskRepository } = createService({
      activeWorkspaceMemberIds: [],
    });
    const enrollment = {
      id: 'enrollment-id',
      createdBy: { workspaceMemberId: 'removed-creator-id' },
    } as SequenceEnrollmentWorkspaceEntity;

    await expect(
      service.createTask({
        workspaceId,
        enrollment,
        person,
        step,
        settings: baseSettings,
        connectedAccountId: null,
        dueAt: null,
        entityManager: transactionManager,
      }),
    ).resolves.toBeUndefined();

    expect(taskRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null }),
      transactionManager,
    );
  });
});
