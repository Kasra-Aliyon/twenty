import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';
import { In } from 'typeorm';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { SequencePersonListener } from 'src/modules/sequence/listeners/sequence-person.listener';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequencePersonListener', () => {
  const workspaceId = 'workspace-id';
  const personId = 'person-id';
  const enrollmentId = 'enrollment-id';
  const emptyPhones = {
    primaryPhoneNumber: '',
    primaryPhoneCountryCode: '',
    primaryPhoneCallingCode: '',
    additionalPhones: null,
  };
  const phones = {
    ...emptyPhones,
    primaryPhoneNumber: '+358401234567',
  };

  const buildPayload = (
    afterPhones = phones,
  ): WorkspaceEventBatch<ObjectRecordUpdateEvent<PersonWorkspaceEntity>> => ({
    name: 'person',
    workspaceId,
    objectMetadata: {} as FlatObjectMetadata,
    events: [
      {
        recordId: personId,
        properties: {
          before: {
            id: personId,
            phones: emptyPhones,
          } as PersonWorkspaceEntity,
          after: {
            id: personId,
            phones: afterPhones,
          } as PersonWorkspaceEntity,
        },
      } as ObjectRecordUpdateEvent<PersonWorkspaceEntity>,
    ],
  });

  const setup = ({
    affected = 1,
    committedPhones = phones,
  }: {
    affected?: number;
    committedPhones?: typeof phones;
  } = {}) => {
    const personFind = jest.fn().mockResolvedValue([
      {
        id: personId,
        phones: committedPhones,
      } as PersonWorkspaceEntity,
    ]);
    const enrollmentFind = jest.fn().mockResolvedValue([
      {
        id: enrollmentId,
        personId,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      } as SequenceEnrollmentWorkspaceEntity,
    ]);
    const enrollmentUpdate = jest.fn().mockResolvedValue({ affected });
    const repositories = new Map<object, object>([
      [PersonWorkspaceEntity, { find: personFind }],
      [
        SequenceEnrollmentWorkspaceEntity,
        { find: enrollmentFind, update: enrollmentUpdate },
      ],
    ]);
    const transactionManager = {} as WorkspaceEntityManager;
    const transaction = jest.fn(async (callback) =>
      callback(transactionManager),
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<unknown>) => callback(),
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction,
      }),
      getRepository: jest.fn(async (_workspaceId: string, entity: object) =>
        repositories.get(entity),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;

    return {
      listener: new SequencePersonListener(
        globalWorkspaceOrmManager,
        sequenceQueueService,
      ),
      transactionManager,
      personFind,
      enrollmentFind,
      enrollmentUpdate,
      enqueueProcess,
    };
  };

  it('continues a pending Apollo step after the phone update commits', async () => {
    const {
      listener,
      transactionManager,
      personFind,
      enrollmentFind,
      enrollmentUpdate,
      enqueueProcess,
    } = setup();

    await listener.handleUpdatedEvent(buildPayload());

    expect(personFind).toHaveBeenCalledWith(
      {
        where: { id: In([personId]) },
        select: ['id', 'phones'],
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(enrollmentFind).toHaveBeenCalledWith(
      {
        where: {
          personId: In([personId]),
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: In([
            SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
            SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
            SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
          ]),
        },
        select: ['id', 'personId', 'waitingOn'],
      },
      transactionManager,
    );
    expect(enrollmentUpdate).toHaveBeenCalledWith(
      {
        id: enrollmentId,
        personId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      },
      {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      },
      transactionManager,
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId,
    });
    expect(enrollmentUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueProcess.mock.invocationCallOrder[0],
    );
  });

  it('does not continue when the committed person has only whitespace for a phone', async () => {
    const { listener, enrollmentFind, enrollmentUpdate, enqueueProcess } =
      setup({
        committedPhones: {
          ...emptyPhones,
          primaryPhoneNumber: '   ',
        },
      });

    await listener.handleUpdatedEvent(buildPayload());

    expect(enrollmentFind).not.toHaveBeenCalled();
    expect(enrollmentUpdate).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('does not enqueue when another transition wins the enrollment CAS', async () => {
    const { listener, enrollmentUpdate, enqueueProcess } = setup({
      affected: 0,
    });

    await listener.handleUpdatedEvent(buildPayload());

    expect(enrollmentUpdate).toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('ignores unrelated person updates', async () => {
    const { listener, personFind, enqueueProcess } = setup();
    const payload = buildPayload(emptyPhones);

    payload.events[0].properties.after.name = {
      firstName: 'Ada',
      lastName: 'Byron',
    };

    await listener.handleUpdatedEvent(payload);

    expect(personFind).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });
});
