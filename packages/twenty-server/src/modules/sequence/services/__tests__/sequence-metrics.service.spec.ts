import { SEQUENCE_ENROLLMENT_STATUSES } from 'twenty-shared/types';
import { In } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceMetricsService', () => {
  const workspaceId = 'workspace-id';
  const sequenceId = 'sequence-id';

  const setup = ({ sequenceExists = true } = {}) => {
    const transactionManager = {} as WorkspaceEntityManager;
    const operations: string[] = [];
    const enrollmentRepository = {
      find: jest.fn().mockImplementation(async () => {
        operations.push('lock-enrollments');

        return [];
      }),
      count: jest
        .fn()
        .mockImplementationOnce(async () => {
          operations.push('count-enrolled');

          return 12;
        })
        .mockImplementationOnce(async () => {
          operations.push('count-active');

          return 4;
        })
        .mockImplementationOnce(async () => {
          operations.push('count-completed');

          return 3;
        })
        .mockImplementationOnce(async () => {
          operations.push('count-replied');

          return 2;
        })
        .mockImplementationOnce(async () => {
          operations.push('count-failed');

          return 1;
        }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockImplementation(async () => {
        operations.push('lock-sequence');

        return sequenceExists ? { id: sequenceId } : null;
      }),
      update: jest.fn().mockImplementation(async () => {
        operations.push('update-sequence');

        return { affected: 1 };
      }),
    };
    const transaction = jest.fn(
      async (callback: (manager: WorkspaceEntityManager) => Promise<void>) =>
        callback(transactionManager),
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getGlobalWorkspaceDataSource: jest
        .fn()
        .mockResolvedValue({ transaction }),
      getRepository: jest.fn(async (_workspaceId, entity) => {
        if (entity === SequenceEnrollmentWorkspaceEntity) {
          return enrollmentRepository;
        }

        if (entity === SequenceWorkspaceEntity) {
          return sequenceRepository;
        }

        throw new Error('Unexpected repository');
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const service = new SequenceMetricsService(globalWorkspaceOrmManager);

    return {
      service,
      transactionManager,
      transaction,
      enrollmentRepository,
      sequenceRepository,
      operations,
    };
  };

  it('locks the sequence before reading and updating its counters', async () => {
    const {
      service,
      transactionManager,
      transaction,
      enrollmentRepository,
      sequenceRepository,
      operations,
    } = setup();

    await service.recomputeForSequence({
      workspaceId,
      sequenceId,
      enrollmentIdsToLock: ['first-enrollment-id', 'second-enrollment-id'],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      {
        where: { id: sequenceId },
        select: ['id'],
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(enrollmentRepository.find).toHaveBeenCalledWith(
      {
        where: {
          id: In(['first-enrollment-id', 'second-enrollment-id']),
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(enrollmentRepository.count).toHaveBeenNthCalledWith(
      1,
      { where: { sequenceId } },
      transactionManager,
    );
    expect(enrollmentRepository.count).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          sequenceId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        },
      },
      transactionManager,
    );
    expect(sequenceRepository.update).toHaveBeenCalledWith(
      sequenceId,
      {
        enrolledCount: 12,
        activeCount: 4,
        completedCount: 3,
        repliedCount: 2,
        failedCount: 1,
      },
      transactionManager,
    );
    expect(operations).toEqual([
      'lock-sequence',
      'lock-enrollments',
      'count-enrolled',
      'count-active',
      'count-completed',
      'count-replied',
      'count-failed',
      'update-sequence',
    ]);
  });

  it('does not write counters after the sequence was deleted', async () => {
    const { service, enrollmentRepository, sequenceRepository, operations } =
      setup({ sequenceExists: false });

    await service.recomputeForSequence({ workspaceId, sequenceId });

    expect(enrollmentRepository.find).not.toHaveBeenCalled();
    expect(enrollmentRepository.count).not.toHaveBeenCalled();
    expect(sequenceRepository.update).not.toHaveBeenCalled();
    expect(operations).toEqual(['lock-sequence']);
  });
});
