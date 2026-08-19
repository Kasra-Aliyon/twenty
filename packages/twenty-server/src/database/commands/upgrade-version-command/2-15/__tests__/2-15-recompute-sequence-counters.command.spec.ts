import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { RecomputeSequenceCountersCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000024000-recompute-sequence-counters.command';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';

describe('RecomputeSequenceCountersCommand', () => {
  const setup = () => {
    const find = jest
      .fn()
      .mockResolvedValue([
        { id: 'first-sequence-id' },
        { id: 'second-sequence-id' },
      ]);
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<string[]>) => callback(),
      ),
      getRepository: jest.fn().mockResolvedValue({ find }),
    } as unknown as GlobalWorkspaceOrmManager;
    const recomputeForSequence = jest.fn();
    const command = new RecomputeSequenceCountersCommand(
      {} as WorkspaceIteratorService,
      globalWorkspaceOrmManager,
      { recomputeForSequence } as unknown as SequenceMetricsService,
    );

    return { command, find, recomputeForSequence };
  };

  it('recomputes every existing sequence so stale counters are repaired once', async () => {
    const { command, find, recomputeForSequence } = setup();

    await command.runOnWorkspace({
      workspaceId: 'workspace-id',
      options: {},
      index: 0,
      total: 1,
    });

    expect(find).toHaveBeenCalledWith({
      select: ['id'],
      withDeleted: true,
    });
    expect(recomputeForSequence.mock.calls).toEqual([
      [
        {
          workspaceId: 'workspace-id',
          sequenceId: 'first-sequence-id',
        },
      ],
      [
        {
          workspaceId: 'workspace-id',
          sequenceId: 'second-sequence-id',
        },
      ],
    ]);
  });

  it('reports the repair scope without changing counters during a dry run', async () => {
    const { command, recomputeForSequence } = setup();

    await command.runOnWorkspace({
      workspaceId: 'workspace-id',
      options: { dryRun: true },
      index: 0,
      total: 1,
    });

    expect(recomputeForSequence).not.toHaveBeenCalled();
  });
});
