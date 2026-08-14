import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';

describe('TimelineActivityRepository', () => {
  const setup = ({
    existingTimelineActivity,
  }: { existingTimelineActivity?: object } = {}) => {
    const find = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        existingTimelineActivity ? [existingTimelineActivity] : [],
      );
    const insert = jest.fn();
    const update = jest.fn();
    const upsert = jest.fn();
    const workspaceRepository = { find, insert, update, upsert };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<unknown>) => callback(),
      ),
      getRepository: jest.fn().mockResolvedValue(workspaceRepository),
    } as unknown as GlobalWorkspaceOrmManager;

    return {
      find,
      globalWorkspaceOrmManager,
      insert,
      repository: new TimelineActivityRepository(globalWorkspaceOrmManager),
      update,
      upsert,
    };
  };

  it('uses a database upsert for deterministic timeline activities', async () => {
    const { insert, repository, upsert } = setup();
    const happensAt = new Date('2026-08-13T09:00:00.000Z');

    await repository.upsertTimelineActivities({
      objectSingularName: 'person',
      payloads: [
        {
          happensAt,
          id: 'activity-id',
          name: 'linkedin.message-received',
          properties: {},
          recordId: 'person-id',
          workspaceMemberId: 'workspace-member-id',
        },
      ],
      workspaceId: WORKSPACE_ID,
    });

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          happensAt,
          id: 'activity-id',
          name: 'linkedin.message-received',
          targetPersonId: 'person-id',
          workspaceMemberId: 'workspace-member-id',
        }),
      ],
      ['id'],
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('updates the target and timestamp when a deterministic activity is replayed', async () => {
    const { repository, update, upsert } = setup({
      existingTimelineActivity: {
        id: 'activity-id',
        name: 'linkedin.message-received',
        properties: {},
        targetPersonId: 'old-person-id',
        workspaceMemberId: 'workspace-member-id',
      },
    });
    const happensAt = new Date('2026-08-13T09:00:00.000Z');

    await repository.upsertTimelineActivities({
      objectSingularName: 'person',
      payloads: [
        {
          happensAt,
          id: 'activity-id',
          name: 'linkedin.message-received',
          properties: {},
          recordId: 'corrected-person-id',
          workspaceMemberId: 'workspace-member-id',
        },
      ],
      workspaceId: WORKSPACE_ID,
    });

    expect(update).toHaveBeenCalledWith(
      'activity-id',
      expect.objectContaining({
        happensAt,
        targetPersonId: 'corrected-person-id',
      }),
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps the last deterministic payload when a batch contains the same source twice', async () => {
    const { repository, upsert } = setup();

    await repository.upsertTimelineActivities({
      objectSingularName: 'person',
      payloads: [
        {
          id: 'activity-id',
          name: 'linkedin.message-received',
          properties: {},
          recordId: 'old-person-id',
        },
        {
          id: 'activity-id',
          name: 'linkedin.message-received',
          properties: {},
          recordId: 'corrected-person-id',
        },
      ],
      workspaceId: WORKSPACE_ID,
    });

    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ targetPersonId: 'corrected-person-id' })],
      ['id'],
    );
  });

  it('returns before opening a workspace context for an empty batch', async () => {
    const { globalWorkspaceOrmManager, repository } = setup();

    await repository.upsertTimelineActivities({
      objectSingularName: 'person',
      payloads: [],
      workspaceId: WORKSPACE_ID,
    });

    expect(
      globalWorkspaceOrmManager.executeInWorkspaceContext,
    ).not.toHaveBeenCalled();
  });
});
