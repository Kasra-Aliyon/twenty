import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  SEQUENCE_PROCESS_ENROLLMENT_JOB_NAME,
  SEQUENCE_PROCESS_JOB_ID_PREFIX,
  SEQUENCE_PROCESS_JOB_RETRY_BACKOFF_MILLISECONDS,
  SEQUENCE_PROCESS_JOB_RETRY_LIMIT,
} from 'src/modules/sequence/sequence.constants';

describe('SequenceQueueService', () => {
  it('retries transient process failures with exponential backoff', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const service = new SequenceQueueService({
      add,
    } as unknown as MessageQueueService);

    await service.enqueueProcess({
      workspaceId: 'workspace-id',
      enrollmentId: 'enrollment-id',
    });

    expect(add).toHaveBeenCalledWith(
      SEQUENCE_PROCESS_ENROLLMENT_JOB_NAME,
      {
        workspaceId: 'workspace-id',
        enrollmentId: 'enrollment-id',
      },
      {
        id: `${SEQUENCE_PROCESS_JOB_ID_PREFIX}:workspace-id:enrollment-id`,
        retryLimit: SEQUENCE_PROCESS_JOB_RETRY_LIMIT,
        backoff: {
          type: 'exponential',
          delay: SEQUENCE_PROCESS_JOB_RETRY_BACKOFF_MILLISECONDS,
        },
      },
    );
  });
});
