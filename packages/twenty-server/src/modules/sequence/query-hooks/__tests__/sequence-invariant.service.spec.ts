import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceInvariantService', () => {
  const authContext = {
    workspace: { id: 'workspace-id' },
  } as WorkspaceAuthContext;
  const sequence = {
    id: 'sequence-id',
    deletedAt: null,
    status: SEQUENCE_STATUSES.PAUSED,
    senderConnectedAccountId: 'sender-id',
    settings: { stopOnReply: true },
  } as SequenceWorkspaceEntity;
  const enrollment = {
    id: 'enrollment-id',
    sequenceId: sequence.id,
    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
  } as SequenceEnrollmentWorkspaceEntity;
  let activeEnrollmentCount: number;
  let sequenceRepository: {
    find: jest.Mock;
  };
  let service: SequenceInvariantService;
  const sequenceSenderService = {
    getReadySenderOrThrow: jest.fn(),
  } as unknown as SequenceSenderService;

  beforeEach(() => {
    jest.clearAllMocks();
    activeEnrollmentCount = 0;
    sequenceRepository = {
      find: jest.fn().mockResolvedValue([sequence]),
    };
    const stepRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'step-id',
          sequenceId: sequence.id,
          settings: {
            type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
            subject: 'Hello',
            bodyHtml: '<p>Hello</p>',
            threadAsReplyToPreviousEmail: false,
            stopOnReply: null,
          },
        },
      ]),
      count: jest.fn().mockResolvedValue(1),
    };
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(enrollment),
      count: jest.fn().mockImplementation(async () => activeEnrollmentCount),
    };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) => {
        if (entity === SequenceWorkspaceEntity) return sequenceRepository;
        if (entity === SequenceStepWorkspaceEntity) return stepRepository;
        if (entity === 'sequenceEnrollment') return enrollmentRepository;
        return {};
      }),
    } as unknown as GlobalWorkspaceOrmManager;

    service = new SequenceInvariantService(
      globalWorkspaceOrmManager,
      sequenceSenderService,
    );
  });

  it('forces engine-owned enrollment fields on create', async () => {
    const [normalized] = await service.normalizeEnrollmentCreates({
      authContext,
      data: [
        {
          sequenceId: sequence.id,
          personId: 'person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
          currentStepId: 'attacker-step-id',
          senderConnectedAccountId: 'attacker-sender-id',
        },
      ],
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        currentStepId: null,
        currentStepPosition: -1,
        senderConnectedAccountId: sequence.senderConnectedAccountId,
        stopOnReply: true,
        sentEmailsByStepId: {},
      }),
    );
  });

  it('rejects enrollment in an archived sequence', async () => {
    sequenceRepository.find.mockResolvedValueOnce([
      { ...sequence, deletedAt: new Date() },
    ]);

    await expect(
      service.normalizeEnrollmentCreates({
        authContext,
        data: [
          {
            sequenceId: sequence.id,
            personId: 'person-id',
          },
        ],
      }),
    ).rejects.toThrow('archived sequence');
  });

  it('forces new sequences to start as drafts with empty counters', () => {
    expect(
      service.normalizeSequenceCreate({
        status: SEQUENCE_STATUSES.ACTIVE,
        activeCount: 10,
      }),
    ).toEqual(
      expect.objectContaining({
        status: SEQUENCE_STATUSES.DRAFT,
        enrolledCount: 0,
        activeCount: 0,
        completedCount: 0,
        repliedCount: 0,
        failedCount: 0,
      }),
    );
  });

  it('allows supported terminal and skip actions while normalizing timestamps', async () => {
    const terminalUpdate = await service.normalizeEnrollmentUpdate({
      authContext,
      enrollmentId: enrollment.id,
      data: {
        status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
        endedAt: new Date(0),
      },
    });
    const skipUpdate = await service.normalizeEnrollmentUpdate({
      authContext,
      enrollmentId: enrollment.id,
      data: {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(0),
      },
    });

    expect(terminalUpdate).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
        waitingOn: null,
        nextActionAt: null,
      }),
    );
    expect(skipUpdate.waitingOn).toBe(SEQUENCE_WAITING_ON.DELAY);
    expect(skipUpdate.nextActionAt?.getTime()).toBeGreaterThan(0);
  });

  it('rejects direct writes to engine-owned enrollment state', async () => {
    await expect(
      service.normalizeEnrollmentUpdate({
        authContext,
        enrollmentId: enrollment.id,
        data: { currentStepId: 'attacker-step-id' },
      }),
    ).rejects.toThrow('Enrollment execution state');
  });

  it('rejects step edits while the sequence has an active enrollment', async () => {
    activeEnrollmentCount = 1;

    await expect(
      service.assertStepMutationAllowed({
        authContext,
        stepId: 'step-id',
      }),
    ).rejects.toThrow('Pause the sequence');
  });

  it('requires a ready, syncing sender before activation', async () => {
    await service.assertSequenceUpdateAllowed({
      authContext,
      sequenceId: sequence.id,
      data: { status: SEQUENCE_STATUSES.ACTIVE },
    });

    expect(sequenceSenderService.getReadySenderOrThrow).toHaveBeenCalledWith({
      connectedAccountId: sequence.senderConnectedAccountId,
      expectedUserWorkspaceId: undefined,
      workspaceId: authContext.workspace.id,
    });
  });

  it('blocks activation when sender inbox sync is unavailable', async () => {
    jest
      .mocked(sequenceSenderService.getReadySenderOrThrow)
      .mockRejectedValueOnce(new Error('Enable inbox sync'));

    await expect(
      service.assertSequenceUpdateAllowed({
        authContext,
        sequenceId: sequence.id,
        data: { status: SEQUENCE_STATUSES.ACTIVE },
      }),
    ).rejects.toThrow('Enable inbox sync');
  });

  it('allows an active sequence to be archived so its open work can be stopped', async () => {
    sequenceRepository.find.mockResolvedValueOnce([
      { ...sequence, status: SEQUENCE_STATUSES.ACTIVE },
    ]);

    await expect(
      service.assertSequenceArchiveAllowed({
        authContext,
        sequenceId: sequence.id,
      }),
    ).resolves.toBeUndefined();
  });

  it('only allows permanent deletion after a sequence is archived', async () => {
    await expect(
      service.assertSequenceDestroyAllowed({
        authContext,
        sequenceId: sequence.id,
      }),
    ).rejects.toThrow('Archive the sequence');

    sequenceRepository.find.mockResolvedValueOnce([
      { ...sequence, deletedAt: new Date() },
    ]);

    await expect(
      service.assertSequenceDestroyAllowed({
        authContext,
        sequenceId: sequence.id,
      }),
    ).resolves.toBeUndefined();
  });

  it('only allows archived sequences to be restored', async () => {
    await expect(
      service.assertSequenceRestoreAllowed({
        authContext,
        sequenceId: sequence.id,
      }),
    ).rejects.toThrow('Only an archived sequence');

    sequenceRepository.find.mockResolvedValueOnce([
      { ...sequence, deletedAt: new Date() },
    ]);

    await expect(
      service.assertSequenceRestoreAllowed({
        authContext,
        sequenceId: sequence.id,
      }),
    ).resolves.toBeUndefined();
  });
});
