import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('sequence activation malformed-step regressions', () => {
  const authContext = {
    workspace: { id: 'workspace-id' },
  } as WorkspaceAuthContext;

  const activateWithSteps = async (
    steps: Partial<SequenceStepWorkspaceEntity>[],
  ): Promise<void> => {
    const sequence = {
      id: 'sequence-id',
      deletedAt: null,
      status: SEQUENCE_STATUSES.DRAFT,
      senderConnectedAccountId: 'sender-id',
      settings: DEFAULT_SEQUENCE_SETTINGS,
    } as SequenceWorkspaceEntity;
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) => {
        if (entity === SequenceWorkspaceEntity) {
          return { find: jest.fn().mockResolvedValue([sequence]) };
        }

        if (entity === SequenceStepWorkspaceEntity) {
          return { find: jest.fn().mockResolvedValue(steps) };
        }

        if (entity === 'sequenceEnrollment') {
          return { count: jest.fn().mockResolvedValue(0) };
        }

        throw new Error('Unexpected repository');
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const sequenceSenderService = {
      getReadySenderOrThrow: jest.fn(),
      getSenderAccountOrThrow: jest.fn(),
    } as unknown as SequenceSenderService;
    const service = new SequenceInvariantService(
      globalWorkspaceOrmManager,
      sequenceSenderService,
    );

    await service.assertSequenceUpdateAllowed({
      authContext,
      sequenceId: sequence.id,
      data: { status: SEQUENCE_STATUSES.ACTIVE },
    });
  };

  it('rejects a step that collides with the new-enrollment position sentinel', async () => {
    await expect(
      activateWithSteps([
        {
          id: 'negative-step',
          position: -1,
          settings: {
            type: SEQUENCE_STEP_TYPES.DELAY,
            days: 0,
            hours: 0,
            minutes: 1,
          },
        } as SequenceStepWorkspaceEntity,
      ]),
    ).rejects.toThrow('invalid position');
  });

  it('rejects duplicate positions within the same branch', async () => {
    const delaySettings = {
      type: SEQUENCE_STEP_TYPES.DELAY,
      days: 0,
      hours: 0,
      minutes: 1,
    } as const;

    await expect(
      activateWithSteps([
        {
          id: 'first-step',
          position: 0,
          settings: delaySettings,
        } as SequenceStepWorkspaceEntity,
        {
          id: 'second-step',
          position: 0,
          settings: delaySettings,
        } as SequenceStepWorkspaceEntity,
      ]),
    ).rejects.toThrow('duplicate position');
  });

  it.each([
    {
      label: 'delay',
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 100_000_000_000,
        hours: 0,
        minutes: 0,
      },
    },
    {
      label: 'task deadline',
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Follow up',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DEADLINE' as const,
        deadlineDays: 100_000_000_000,
      },
    },
    {
      label: 'withdrawal delay',
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
        withdrawAfterDays: 100_000_000_000,
        withdrawAfterHours: 0,
      },
    },
  ])(
    'rejects a $label that overflows the supported date range',
    async ({ settings }) => {
      await expect(
        activateWithSteps([
          {
            id: 'overflow-step',
            position: 0,
            settings,
          } as SequenceStepWorkspaceEntity,
        ]),
      ).rejects.toThrow();
    },
  );

  it.each(['threadAsReplyToPreviousEmail', 'stopOnReply'] as const)(
    'rejects a non-boolean email %s value',
    async (fieldName) => {
      await expect(
        activateWithSteps([
          {
            id: 'email-step',
            position: 0,
            settings: {
              type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
              executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
              subject: 'Hello',
              bodyHtml: '<p>Hello</p>',
              threadAsReplyToPreviousEmail: false,
              stopOnReply: null,
              [fieldName]: 'false',
            },
          } as unknown as SequenceStepWorkspaceEntity,
        ]),
      ).rejects.toThrow('not fully configured');
    },
  );

  it('rejects unsupported reply automation on a manual email task', async () => {
    await expect(
      activateWithSteps([
        {
          id: 'manual-email-step',
          position: 0,
          settings: {
            type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
            executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
            subject: 'Hello',
            bodyHtml: '<p>Hello</p>',
            threadAsReplyToPreviousEmail: false,
            stopOnReply: null,
          },
        } as SequenceStepWorkspaceEntity,
      ]),
    ).rejects.toThrow('cannot use reply threading or automatic stop-on-reply');
  });
});
