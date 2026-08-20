import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

jest.mock(
  'src/engine/twenty-orm/storage/orm-workspace-context.storage',
  () => ({
    getWorkspaceContext: () => ({
      apiKeyRoleMap: {},
      userWorkspaceRoleMap: { 'user-workspace-id': 'role-id' },
    }),
  }),
);

describe('SequenceInvariantService readiness permissions', () => {
  const authContext = {
    type: 'user',
    workspace: { id: 'workspace-id' },
    userWorkspaceId: 'user-workspace-id',
  } as WorkspaceAuthContext;

  const setup = ({ readableStepCount }: { readableStepCount: number }) => {
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'sequence-id' }),
    };
    const permittedStepRepository = {
      find: jest.fn().mockResolvedValue(
        Array.from({ length: readableStepCount }, (_, index) => ({
          id: `step-${index}`,
        })),
      ),
    };
    const internalStepRepository = {
      count: jest.fn().mockResolvedValue(1),
    };
    const getRepository = jest.fn(
      async (_workspaceId, entity, permissionConfig) => {
        if (entity === SequenceWorkspaceEntity) return sequenceRepository;
        if (
          entity === SequenceStepWorkspaceEntity &&
          permissionConfig?.shouldBypassPermissionChecks === true
        ) {
          return internalStepRepository;
        }
        if (entity === SequenceStepWorkspaceEntity) {
          return permittedStepRepository;
        }

        throw new Error('Unexpected repository');
      },
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository,
    } as unknown as GlobalWorkspaceOrmManager;
    const service = new SequenceInvariantService(
      globalWorkspaceOrmManager,
      {} as SequenceSenderService,
    );

    return { getRepository, service };
  };

  it('checks sequence and step fields through the caller role before readiness', async () => {
    const { getRepository, service } = setup({ readableStepCount: 1 });

    await expect(
      service.assertSequenceReadable({
        authContext,
        sequenceId: 'sequence-id',
      }),
    ).resolves.toBeUndefined();

    expect(getRepository).toHaveBeenCalledWith(
      'workspace-id',
      SequenceWorkspaceEntity,
      { intersectionOf: ['role-id'] },
    );
    expect(getRepository).toHaveBeenCalledWith(
      'workspace-id',
      SequenceStepWorkspaceEntity,
      { intersectionOf: ['role-id'] },
    );
  });

  it('denies readiness when row permissions hide any sequence step', async () => {
    const { service } = setup({ readableStepCount: 0 });

    await expect(
      service.assertSequenceReadable({
        authContext,
        sequenceId: 'sequence-id',
      }),
    ).rejects.toThrow('does not have permission');
  });
});
